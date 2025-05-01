// Initialize map centered on the United States
var lastCenter = { "lat": 39.8283, "lon": -98.5795}

var map = L.map('map').setView([lastCenter.lat, lastCenter.lon], 4);

// OSM standard tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 16,
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

var paraglidingLayer = L.layerGroup().addTo(map);
var markerById = {}; // Store markers by OSM type/id for list interaction

// A marker on the map for the search results
var searchMarker = null;

// Request browser location
if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
        function(position) {
            // On success, center map on user location
            var lat = position.coords.latitude;
            var lng = position.coords.longitude;
            map.setView([lat, lng], 12, { animate: true });
        },
        function(error) {
            console.error("Error getting location:", error);
        }
    );
} else {
    console.warn("Geolocation not supported by this browser.");
}

// Handle search
async function setupSearch() {
  const searchButton = await waitForElm('#searchBtn')
  searchButton.addEventListener('click', function() {
      var query = document.getElementById('searchInput').value.trim();
      if (!query) return;

      // Check if the query is in a coordinate format (simple check: contain comma)
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
  });
}

function centerMapAndAddMarker(lat, lng) {
    map.setView([lat, lng], 12, { animate: true });
    if (searchMarker) {
        map.removeLayer(searchMarker);
    }
    searchMarker = L.marker([lat, lng]).addTo(map);
}

// Fetch paragliding sites from Overpass
function fetchParaglidingSites() {
    paraglidingLayer.clearLayers();
    markerById = {};
    var bounds = map.getBounds();
    var bbox = [
        bounds.getSouthWest().lat,
        bounds.getSouthWest().lng,
        bounds.getNorthEast().lat,
        bounds.getNorthEast().lng
    ].join(',');

    var query = `
[out:json][timeout:25];
(
nwr["sport"="free_flying"](${bbox});
);
out center tags;
`;
    var url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query);

    // Show a loading message in the sidebar
    document.getElementById('siteList').innerHTML = "<li class='py-1'>Loading...</li>";

    fetch(url)
        .then(response => response.json())
        .then(data => {
            var elements = data.elements;
            var sites = [];

            elements.forEach(function(element) {
                var lat, lon;
                if (element.type === "node") {
                    lat = element.lat;
                    lon = element.lon;
                } else if (element.type === "way" || element.type === "relation") {
                    lat = element.center && element.center.lat;
                    lon = element.center && element.center.lon;
                }
                if (lat && lon) {
                    var name = element.tags && element.tags.name ? element.tags.name : '(Unnamed paragliding site)';
                    var osmUrl = "https://www.openstreetmap.org/" + element.type + "/" + element.id;

                    // Build popup content with all tags
                    var tagInfo = '';
                    if (element.tags) {
                        tagInfo = Object.keys(element.tags).map(function (key) {
                            return "<b>" + key + ":</b> " + element.tags[key];
                        }).join("<br/>");
                    }

                    var popupContent = "<b>" + name + "</b><br/><a href=\"" + osmUrl + "\" target=\"_blank\">View on OSM</a>";
                    if (tagInfo) {
                        popupContent += "<br/>" + tagInfo;
                    }

                    var marker = L.marker([lat, lon])
                        .bindPopup(popupContent)
                        .addTo(paraglidingLayer);

                    var key = element.type + "/" + element.id;
                    markerById[key] = marker;

                    // Push info for sidebar
                    sites.push({
                        key: key,
                        name: name,
                        osmUrl: osmUrl
                    });
                }
            });
            updateSiteList(sites);
            lastCenter = map.getCenter();
        })
        .catch(err => {
            console.error('Failed to fetch Overpass data', err);
            document.getElementById('siteList').innerHTML = "<li class='py-1 text-red-600'>Failed to load data</li>";
        });
}
// Movement threshold logic (10% of map size)
function shouldFetchNewData() {
    const currentCenter = map.getCenter();
    console.debug("last center", lastCenter, "current center", currentCenter)
    const bounds = map.getBounds();

    const latDiff = Math.abs(currentCenter.lat - lastCenter.lat);
    const lngDiff = Math.abs(currentCenter.lng - lastCenter.lng);

    const latThreshold = (bounds.getNorth() - bounds.getSouth()) * 0.10;
    const lngThreshold = (bounds.getEast() - bounds.getWest()) * 0.10;

    const shouldFetch =  latDiff > latThreshold || lngDiff > lngThreshold;
    console.log("fetch new data?", shouldFetch)
    return shouldFetch
}

function onMapMoved() {
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
                map.setView(marker.getLatLng(), Math.max(map.getZoom(), 12), { animate: true });
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
map.on('moveend', onMapMoved);

// Fetch on load
fetchParaglidingSites();
setupSearch();

