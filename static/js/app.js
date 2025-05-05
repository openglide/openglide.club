// Initialize map centered on the United States
var lastCenter = { "lat": 39.8283, "lon": -98.5795}

var map = L.map('map').setView([lastCenter.lat, lastCenter.lon], 4);

// OSM standard tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// The map zoom level at which site geometries are rendered on the map
const geometryZoom = 14;

var paraglidingLayer = L.layerGroup().addTo(map);
var markerById       = {}; // key => layer
var searchMarker     = null;

// A marker on the map for the search results
var searchMarker = null;

async function doSearch() {
      const searchField =  document.getElementById('searchInput')
      var query = searchField.value.trim();
      if (!query) return;

      // Check if the query is in a coordinate format: "NUM, NUM"
      if (query.includes(',')) {
          var parts = query.split(',');
          if (parts.length === 2) {
              var lat = parseFloat(parts[0]);
              var lng = parseFloat(parts[1]);
              if (!isNaN(lat) && !isNaN(lng)) {
                  // Coordinates found, center map and add marker
                  centerMapAndAddMarker(lat, lng);
                  return;
              }
          }
      }

      // Otherwise, treat as a name (geocode with Nominatim)
      var nominatimUrl = 'https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(query);
      fetch(nominatimUrl)
          .then(response => response.json())
          .then(data => {
              if (data && data.length > 0) {
                  // Use the first result for simplicity
                  var lat = parseFloat(data[0].lat);
                  var lng = parseFloat(data[0].lon);
                  centerMapAndAddMarker(lat, lng);
              } else {
                  alert('No results found for "' + query + '".');
              }
          })
          .catch(err => {
              console.error('Error during Nominatim fetch: ', err);
          });
  }

function centerMapAndAddMarker(lat, lng) {
    map.setView([lat, lng], 12, { animate: true });
    if (searchMarker) {
        map.removeLayer(searchMarker);
    }
    searchMarker = L.marker([lat, lng]).addTo(map);
}

function fetchParaglidingSites() {
  paraglidingLayer.clearLayers();
  markerById = {};

  const bounds = map.getBounds();
  const bbox   = [
    bounds.getSouthWest().lat,
    bounds.getSouthWest().lng,
    bounds.getNorthEast().lat,
    bounds.getNorthEast().lng
  ].join(',');

  const query = `
    [out:json][timeout:25];
    (
      nwr["sport"="free_flying"](${bbox});
      nwr["free_flying:paragliding"="yes"](${bbox});
      nwr["free_flying:hanggliding"="yes"](${bbox});
      nwr["free_flying:site"="landing"](${bbox});
      nwr["free_flying:site"="launch"](${bbox});
      nwr["sport"="free_flying"]["aeroway"="aerodrome"](${bbox});
      nwr["aeroway"="runway"]["note"="paragliding"](${bbox});
    );
    out center tags geom;
  `;
  const url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query);

  document.getElementById('siteList').innerHTML = "<li class='py-1'>Loading...</li>";

  fetch(url)
    .then(r => r.json())
    .then(data => {
  const currentZoom = map.getZoom();
  const sites = [];

  data.elements.forEach(el => {
    const key = el.type + "/" + el.id;
    const name = el.tags?.name || "(Unnamed paragliding site)";
    const osmUrl = "https://www.openstreetmap.org/" + key;

    // make your popup
    let tagInfo = "";
    if (el.tags) {
      tagInfo = Object.entries(el.tags)
        .map(([k,v]) => `<b>${k}:</b> ${v}`)
        .join("<br>");
    }
    const popupContent = `
      <b>${name}</b><br>
      <a href="${osmUrl}" target="_blank">View on OSM</a>
      ${tagInfo ? "<br>" + tagInfo : ""}
    `;

    const isNode = el.type === "node";
    const center = elementCenter(el)
    const showMarker = isNode || (!isNode && currentZoom < geometryZoom);
    const showGeom   = !isNode && currentZoom >= geometryZoom && Array.isArray(el.geometry);
    if (showMarker && center) {
      const m = L.marker(center)
        .bindPopup(popupContent)
        .addTo(paraglidingLayer);
      markerById[key] = m;
      sites.push({ key, name, osmUrl });
    }
    else if (showGeom) {
      const coords = el.geometry.map(pt => [pt.lon, pt.lat]);
      const geom = (coords.length > 2
                    && coords[0][0] === coords[coords.length-1][0]
                    && coords[0][1] === coords[coords.length-1][1])
        ? { type: "Polygon",    coordinates: [coords] }
        : { type: "LineString", coordinates: coords };

      const feature = {
        type: "Feature",
        properties: { name, osmUrl },
        geometry: geom
      };
      const layer = L.geoJSON(feature, {
        style: { color: "#0077cc", weight: 3 },
        onEachFeature: (_, lyr) => lyr.bindPopup(popupContent)
      }).addTo(paraglidingLayer);

      markerById[key] = layer;
      sites.push({ key, name, osmUrl });
    }
  });

  updateSiteList(sites);
  lastCenter = map.getCenter();
  lastZoom   = map.getZoom();
})
    .catch(err => {
      console.error("Failed to fetch Overpass data", err);
      document.getElementById("siteList").innerHTML =
        "<li class='py-1 text-red-600'>Failed to load data</li>";
    });
}

function elementCenter(el) {
  const isNode = el.type === "node";
  if (isNode) {
    return [el.lat, el.lon];
  } else if (el.center) {
    return [el.center.lat, el.center.lon];
  } else if (el.geometry) {
    // fallback: average via leaflet bounds
    const latlngs = el.geometry.map(pt => [pt.lat, pt.lon]);
    const bounds  = L.polyline(latlngs).getBounds();
    const c       = bounds.getCenter();
    return [c.lat, c.lng];
  } else if (el.bounds) {
    const b = el.bounds;
    const bounds  = L.polyline([[b.maxlat, b.maxlon], [b.minlat, b.minlon ]]).getBounds();
    const c       = bounds.getCenter();
    return [c.lat, c.lng];   
  }
  return null
}

// Movement threshold logic (10% of map size)
function shouldFetchNewData() {
    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();
    const bounds = map.getBounds();
    const zoomedOut = currentZoom < lastZoom

    const latDiff = Math.abs(currentCenter.lat - lastCenter.lat);
    const lngDiff = Math.abs(currentCenter.lng - lastCenter.lng);

    const latThreshold = (bounds.getNorth() - bounds.getSouth()) * 0.10;
    const lngThreshold = (bounds.getEast() - bounds.getWest()) * 0.10;

    const shouldFetch =  latDiff > latThreshold || lngDiff > lngThreshold || zoomedOut;
    // console.log("fetch new data?", shouldFetch, "current zooom", currentZoom, "current center", currentCenter, "last center", lastCenter)
    return shouldFetch
}

function onViewportChange() {
    if (shouldFetchNewData()) {
        fetchParaglidingSites();
    }
}

function updateSiteList(sites) {
    var list = document.getElementById('siteList');
    if (!sites.length) {
        list.innerHTML = "<li class='py-1'>No paragliding site found in view.</li>";
        return;
    }
    list.innerHTML = '';
    sites.forEach(function(site) {
        var li = document.createElement('li');
        li.textContent = site.name;
        li.title = "Click to show on map";
        li.className = "py-1 pl-0.5 pr-1 hover:bg-blue-50 border-b border-gray-200 cursor-pointer flex items-center justify-between";
        li.onclick = function() {
            var marker = markerById[site.key];
            if(marker){
                map.setView(marker.getLatLng(), Math.max(map.getZoom(), geometryZoom), { animate: true });
                marker.openPopup();
            }
        };
        // Optional: Add a "view on osm" link beside the name
        var osmA = document.createElement('a');
        osmA.href = site.osmUrl;
        osmA.target = "_blank";
        osmA.textContent = "↗";
        osmA.className = "site-link text-blue-700 hover:underline ml-2";
        osmA.onclick = function(e) {
            e.stopPropagation();
        };
        li.appendChild(osmA);
        list.appendChild(li);
    });
}

function waitForElm(selector) {
    return new Promise(resolve => {
        if (document.querySelector(selector)) {
            return resolve(document.querySelector(selector));
        }

        const observer = new MutationObserver(mutations => {
            if (document.querySelector(selector)) {
                observer.disconnect();
                resolve(document.querySelector(selector));
            }
        });

        // If you get "parameter 1 is not of type 'Node'" error, see https://stackoverflow.com/a/77855838/492336
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
}

// Fetch and update when map stops moving
map.on('moveend', onViewportChange);
// map.on('zoomend', onViewportChange);

// Fetch on load
fetchParaglidingSites();

