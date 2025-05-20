window.renderSiteDetails = function(contentHtml) {
  var drawer = document.getElementById("sidebar");
  var content = document.getElementById("drawerContent");
  content.innerHTML = contentHtml;
  drawer.classList.remove("hidden");
};

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  sidebar.classList.toggle("hidden");
}

window.siteSelected = function siteSelected(selectedSite) {
  panToFeature(selectedSite);
  renderSiteDetails(generateDrawerContent(selectedSite));
  var editorEl = document.getElementById("site_editor");
  // The editor element isn't available in embedded mode
  if (editorEl === null) {
    return
  }
  const editorButton = document.createElement("a");
  const center = elementCenter(selectedSite);
  editorButton.href = `https://editor.openglide.club/#disable_features=traffic_roads,buildings,building_parts,indoor,boundaries&map=17/${center[0]}/${center[1]}&background=Bing`;
  editorButton.textContent = "Edit Site";
  editorButton.target = "_blank";
  editorButton.class = "before:content-['|']"
  editorEl.replaceChildren(editorButton);
};

// osmId returns the OSM id of a feature, or empty string if not an OSM feature
window.osmId = function(feature) {
  switch (true) {
    case feature.id !== null && feature.id !== undefined:
      return `${feature.type}/${feature.id}`
    case feature.ref !== null && feature.ref !== undefined:
      return `${feature.type}/${feature.ref}`
    default:
      return console.error("not a feature")
  }
}

window.embedURL = function() {
  const currentUrl = window.location.href;
  return currentUrl.replace("/map", "/embed")
}

window.generateDrawerContent = (el) => {
  const excludedTags = [
    "name",
    "website",
    "sport",
    "site",
    "area",
    "free_flying:site",
    "type",
    "leisure",
    "fixme",
  ];
  let tagInfo = "";
  if (el.tags) {
    tagInfo =
      `<div class="flex flex-col gap-3">` +
      Object.entries(el.tags)
        .filter(([tag, _]) => {
          return !excludedTags.includes(tag);
        })
        .map(
          ([k, v]) =>
            `
            <div class="my-3">
              <div class="font-bold p-1">${k}</div>
              <div class="p-1">${v}</div>
            </div>
            `,
        )
        .join("") +
      `</div>`;
  }

  var siteGuide = el.tags?.website
    ? `<a href="${el.tags.website}" class="underline" target="_blank">(Site Guide)</a>`
    : "";
  return `
    <div>
      <h3 class="text-xl font-bold mb-3">${el.tags?.name || "(Unnamed site/feature)"} ${siteGuide}</h3>
      ${tagInfo}
    </div>
  `;
};
// panToFeatures pans the map view to the specified feature
function panToFeature(el) {
  const center = bestCoordinate(el);
  if (center && map) {
    window._map.setView(center, Math.max(window._map.getZoom(), 15), {
      animate: true,
    });
  }
}

// bestCoordinatte returns the "best" coordinate for a map feature
//
// For points, it is the point's lat/lon
// For feature's with a "center point", it is that feature's center point
// For free flying sites, it is somewhat arbitrarily the site's first launch, if it has one, otherwise its first LZ
function bestCoordinate(el) {
  const isNode = el.type === "node";
  if (isNode) {
    return [el.lat, el.lon];
  } else if (el.center) {
    return [el.center.lat, el.center.lon];
  } else if (el.geometry) { // It's a free flying site. TODO all things with "gemoetry are not necessarily sites, but this is a decent guess for now
    // fallback: average via leaflet bounds
    const latlngs = el.geometry.map((pt) => [pt.lat, pt.lon]);
    const bounds = L.polyline(latlngs).getBounds();
    const c = bounds.getCenter();
    return [c.lat, c.lng];
  } else if (el.bounds) {
    const b = el.bounds;
    const bounds = L.polyline([
      [b.maxlat, b.maxlon],
      [b.minlat, b.minlon],
    ]).getBounds();
    const c = bounds.getCenter();
    return [c.lat, c.lng];
  }
  return null;
}
// elementCenter returns the center point of an element
function elementCenter(el) {
  const isNode = el.type === "node";
  if (isNode) {
    return [el.lat, el.lon];
  } else if (el.center) {
    return [el.center.lat, el.center.lon];
  } else if (el.geometry) {
    // fallback: average via leaflet bounds
    const latlngs = el.geometry.map((pt) => [pt.lat, pt.lon]);
    const bounds = L.polyline(latlngs).getBounds();
    const c = bounds.getCenter();
    return [c.lat, c.lng];
  } else if (el.bounds) {
    const b = el.bounds;
    const bounds = L.polyline([
      [b.maxlat, b.maxlon],
      [b.minlat, b.minlon],
    ]).getBounds();
    const c = bounds.getCenter();
    return [c.lat, c.lng];
  }
  return null;
}

// loadMap loads the map UI at the specified lattitude and longitude
function loadMap(lat, lon) {
  var lastZoom;

  // The zoom level at which the map initially loads
  const initialZoom = 12;

  // The zoom level at which site geometries are rendered on the map
  const geometryZoom = 14;

  // Initialize map center
  var lastCenter = { lat: lat, lon: lon };

  var map = L.map("map", { maxZoom: 18, zoomControl: false }).setView(
    [lastCenter.lat, lastCenter.lon],
    initialZoom,
  );

  window._map = map;

  // OSM standard tile layer
  var osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  });

  // Esri World Imagery (satellite imagery), no API key needed
  var satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution:
        "&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
    },
  );

  var zoomControl = new L.Control.Zoom({ position: "bottomright" }).addTo(map);

  // make osm the default tile set
  osm.addTo(map);
  zoomControl.addTo(map);

  // Base maps object for layer control
  var baseMaps = {
    OpenStreetMap: osm,
    Satellite: satellite,
  };

  // Add scale layer to help estimate distances
  L.control.scale({ maxWidth: 1000 }).addTo(map);

  // Add layer selector (top-right by default)
  L.control.layers(baseMaps).addTo(map);

  var paraglidingLayer = L.layerGroup().addTo(map);

  // isSporty determines whether a feature is of the correct sport type
  function isSporty(geoJSON) {
    return geoJSON.tags?.sport === "free_flying";
  }

  // isSite determines whether a geoJSON object is a free flying site
  function isSite(geoJSON) {
    return (
      geoJSON.type === "relation" &&
      geoJSON.tags?.type === "site" &&
      geoJSON.tags?.site === "sport" &&
      isSporty(geoJSON)
    );
  }

  // hasMembers determines whether a site is a parent to any members (e.g. landing zone, launches, etc.)
  function hasMembers(geoJSON) {
    return geoJSON.members?.length > 0;
  }

  function fetchParaglidingSites() {
    paraglidingLayer.clearLayers();
    markerById = {};

    const bounds = map.getBounds();
    const bbox = [
      bounds.getSouthWest().lat,
      bounds.getSouthWest().lng,
      bounds.getNorthEast().lat,
      bounds.getNorthEast().lng,
    ].join(",");

    // Query for both relations and all nwr; relation members will be included via Overpass
    const query = `
      [out:json][timeout:25];
      nwr["sport"="free_flying"](${bbox});
      out body geom;
  `;
    const url =
      "https://overpass-api.de/api/interpreter?data=" +
      encodeURIComponent(query);

    document.getElementById("siteList").innerHTML =
      "<li class='py-1'>Loading...</li>";

    fetch(url)
      .then((r) => r.json())
      .then((data) => processQueryResponse(data))
      .catch((err) => {
        console.error("Failed to fetch Overpass data", err);
        document.getElementById("siteList").innerHTML =
          "<li class='py-1 text-red-600'>Failed to load data</li>";
      });
  }

  // getGeometry returns a feature's geometry
  //
  // If a feature is a relation with "members", the geometry of its members are considered the parent feature's geometry
  function getGeometry(geoJSON) {
    if (geoJSON.geometry) {
      return geoJSON.geometry;
    }

    if (geoJSON.members) {
      let memberGeometry = [];
      geoJSON.members
        .filter((m) => m !== undefined && m.geometry)
        .forEach((m) => {
          memberGeometry = memberGeometry.concat(
            m.geometry.filter((g) => g !== undefined),
          );
        });
      return memberGeometry;
    }
    return null;
  }

  // processQueryResponse processes query responses from the overpass API
  function processQueryResponse(opData) {
    const currentZoom = map.getZoom();

    // 1. Split elements into relations/parents and non-site members
    const elements = opData.elements || [];
    const parents = {}; // key = site rel id; val = osm object
    const memberToParent = {}; // key = child OSM id, value = parent OSM id

    // First pass: find all "sites", i.e. sites that contain one or more free flying features like landing zones or launches
    elements
      .filter((el) => isSite(el))
      .forEach((el) => {
        const parentID = window.osmId(el)
        parents[parentID] = {
          el,
          memberKeys: [],
          members: [],
        };
      });

    // Second pass: map all members to their parent, build member lists
    elements
      .filter((el) => isSite(el) && hasMembers(el))
      .map((el) => {
        const parentID = window.osmId(el);
        el.members.forEach((m) => {
          const memberID = window.osmId(m)
          parents[parentID].memberKeys.push(memberID);
          memberToParent[memberID] = parentID;
        });
      });

    // 2. List only top-level "sites" (relations) in sidebar, do not include members as top-level
    // unless a node/way does not belong to any parent sites.
    let sidebarSites = [];

    // We have parent sites in view
    sidebarSites = Object.values(parents).map((p) => {
      const el = p.el;
      const key = "relation/" + el.id;
      const name = el.tags?.name || "(Unnamed site)";
      const osmUrl = "https://www.openstreetmap.org/relation/" + el.id;
      return { key, name, osmUrl, el };
    });

    // fallback: nodes/ways in view that aren't members of a relation, but are sporty
    const standaloneSites = elements
      .filter((el) => !memberToParent[window.osmId(el)] && !isSite(el))
      .map((el) => {
        const key = window.osmId(el);
        const name = el.tags?.name || "(Unnamed site)";
        const osmUrl = "https://www.o!enstreetmap.org/" + key;
        return { key, name, osmUrl, el };
      });
    const standaloneSitesMap = standaloneSites.reduce(function(map, obj) {
      map[obj.key] = obj;
      return map;
    }, {});
    sidebarSites = sidebarSites.concat(standaloneSites);

    // 3. Prepare all features for rendering on map but mark which ones belong to a parent
    // Add marker/geometry for all elements, but record if it's a parent or a child
    const markerOrLayerByFeatureID = {};
    elements.forEach((el) => {
      const featureID = window.osmId(el);
      const isParent = !!parents[featureID];

      // Marker/geometry drawing
      const name = el.tags?.name || "(Unnamed)";
      if (el.tags) {
        tagInfo = Object.entries(el.tags)
          .map(([k, v]) => `<b>${k}:</b> ${v}`)
          .join("<br>");
      }
      const osmUrl = "https://www.openstreetmap.org/" + featureID;
      const center = elementCenter(el);
      const isStandaloneSite = standaloneSitesMap[featureID]
      const showMarker = isParent || isStandaloneSite || currentZoom >= geometryZoom
      const showGeom = getGeometry(el) !== null && currentZoom >= geometryZoom;
      if (showMarker && center && !showGeom) {
        const m = L.marker(center)
          .addTo(paraglidingLayer)
          .on("click", function() {
            siteSelected(el);
          });
        markerOrLayerByFeatureID[featureID] = m;
      } else if (showGeom && !isParent) {
        const coords = getGeometry(el).map((pt) => [pt.lon, pt.lat]);
        const geom =
          coords.length > 2 &&
            coords[0][0] === coords[coords.length - 1][0] &&
            coords[0][1] === coords[coords.length - 1][1]
            ? { type: "Polygon", coordinates: [coords] }
            : { type: "LineString", coordinates: coords };
        const feature = {
          type: "Feature",
          properties: { name, osmUrl },
          geometry: geom,
        };
        const layer = L.geoJSON(feature, {
          style: { color: isParent ? "#0077cc" : "#aa3311", weight: 6 },
          onEachFeature: (_, lyr) => {
            lyr.on("click", function() {
              siteSelected(el);
            });
          },
        }).addTo(paraglidingLayer);

        markerOrLayerByFeatureID[featureID] = layer;
      }
    });

    updateSiteList(sidebarSites);
    lastCenter = map.getCenter();
    lastZoom = map.getZoom();
  }

  // Movement threshold logic (10% of map size)
  function shouldFetchNewData() {
    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();
    const bounds = map.getBounds();
    const zoomedOut = currentZoom < lastZoom;

    const latDiff = Math.abs(currentCenter.lat - lastCenter.lat);
    const lngDiff = Math.abs(currentCenter.lng - lastCenter.lng);

    const latThreshold = (bounds.getNorth() - bounds.getSouth()) * 0.1;
    const lngThreshold = (bounds.getEast() - bounds.getWest()) * 0.1;

    const shouldFetch =
      latDiff > latThreshold || lngDiff > lngThreshold || zoomedOut;
    return shouldFetch;
  }

  function onViewportChange() {
    if (shouldFetchNewData()) {
      fetchParaglidingSites();
    }
  }
  function updateSiteList(sites) {
    var list = document.getElementById("siteList");
    if (!sites.length) {
      list.innerHTML = "<li class='py-1'>No sites found in view.</li>";
      return;
    }
    list.innerHTML = "";
    sites.forEach(function(site) {
      var el = document.createElement("a");
      el.href = "#";
      el.textContent = site.name;
      el.title = "Click to show on map";
      el.className =
        "py-1 pl-0.5 pr-1 hover:bg-blue-50 border-b border-gray-200 cursor-pointer flex items-center justify-between";
      el.onclick = function() {
        siteSelected(site.el);
      };
      list.appendChild(el);
    });
  }

  // Fetch and update when map stops moving
  map.on("moveend", onViewportChange);
  // map.on('zoomend', onViewportChange);

  // Fetch on load
  fetchParaglidingSites();
}
