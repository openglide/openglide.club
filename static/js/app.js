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

// updateSiteList updates the sites in the sidebar
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

// fetchParaglidingSites fetches paragliding sites using the OSM overpass API and adds them to the map
function fetchParaglidingSites() {
  markerById = {};

  const bounds = window._map.getBounds();
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

// processQueryResponse processes query responses from the overpass API
function processQueryResponse(opData) {
  // The zoom level at which site geometries are rendered on the map
  const geometryZoom = 14;
  const currentZoom = window._map.getZoom();

  // 1. Split elements into relations/parents and non-site members
  const osmFeatures = opData.elements || [];
  const parents = {}; // key = site rel id; val = osm object
  const memberToParent = {}; // key = child OSM id, value = parent OSM id

  window._features = {};
  osmFeatures.forEach(feature => {
    const featureID = window.osmId(feature)
    window._features[featureID] = feature;
  })

  // First pass: find all "sites", i.e. sites that contain one or more free flying features like landing zones or launches
  osmFeatures
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
  osmFeatures
    .filter((el) => isSite(el) && hasMembers(el))
    .forEach((el) => {
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
  const standaloneFeatures = osmFeatures
    .filter((el) => !memberToParent[window.osmId(el)] && !isSite(el))
    .map((el) => {
      const key = window.osmId(el);
      const name = el.tags?.name || "(Unnamed site)";
      const osmUrl = "https://www.o!enstreetmap.org/" + key;
      return { key, name, osmUrl, el };
    });
  const standaloneFeaturesDict = standaloneFeatures.reduce(function(map, obj) {
    map[obj.key] = obj;
    return map;
  }, {});
  sidebarSites = sidebarSites.concat(standaloneFeatures);

  // 3. Prepare all features for rendering on map 
  osmFeatures.forEach((feature) => {
    const featureID = window.osmId(feature);
    const isParent = !!parents[featureID];

    // Marker/geometry drawing
    const featureName = feature.tags?.name || "(Unnamed)";
    if (feature.tags) {
      tagInfo = Object.entries(feature.tags)
        .map(([k, v]) => `<b>${k}:</b> ${v}`)
        .join("<br>");
    }
    const paraglidingLayer = L.layerGroup().addTo(window._map);
    const osmUrl = "https://www.openstreetmap.org/" + featureID;
    const center = elementCenter(feature);
    const isStandaloneSite = standaloneFeaturesDict[featureID]
    const showMarker = isParent || isStandaloneSite || currentZoom >= geometryZoom
    const showGeom = getGeometry(feature) !== null && currentZoom >= geometryZoom;
    paraglidingLayer.clearLayers();
    if (showMarker && center && !showGeom) {
      L.marker(center)
        .addTo(paraglidingLayer)
        .on("click", function() {
          siteSelected(feature);
        });
    } else if (showGeom && !isParent) {
      const coords = getGeometry(feature).map((pt) => [pt.lon, pt.lat]);
      const geom =
        coords.length > 2 &&
          coords[0][0] === coords[coords.length - 1][0] &&
          coords[0][1] === coords[coords.length - 1][1]
          ? { type: "Polygon", coordinates: [coords] }
          : { type: "LineString", coordinates: coords };
      const outlinedArea = {
        type: "Feature",
        properties: { name: featureName, osmUrl },
        geometry: geom,
      };
      L.geoJSON(outlinedArea, {
        style: { color: isParent ? "#0077cc" : "#aa3311", weight: 6 },
        onEachFeature: (_, lyr) => {
          lyr.on("click", function() {
            siteSelected(feature);
          });
        },
      }).addTo(paraglidingLayer);
    }
  });

  updateSiteList(sidebarSites);
  lastCenter = window._map.getCenter();
  lastZoom = window._map.getZoom();
}

// getGeometry returns a feature's geometry
//
// If a feature is a relation with "members", the geometry of its members are considered the parent feature's geometry
window.getGeometry = function(geoJSON) {
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

// hasMembers determines whether a site is a parent to any members (e.g. landing zone, launches, etc.)
function hasMembers(geoJSON) {
  return geoJSON.members?.length > 0;
}

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
// panToFeature pans the map view to the specified feature's best coordinate
function panToFeature(feature) {
  const center = bestCoordinate(feature);
  if (center && map) {
    window._map.setView(center, Math.max(window._map.getZoom(), 15), {
      animate: true,
    });
  }
}

// featureCenterPoint finds a feature's center point based on its bounds
function featureCenterPoint(feature) {

  return null
}

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

function boundsCenterPoint(bounds) {
  console.log(bounds)
  const b = L.polyline([
    [bounds.maxlat, bounds.maxlon],
    [bounds.minlat, bounds.minlon],
  ]).getBounds();
  console.log(b)
  const c = b.getCenter();
  return [c.lat, c.lng];
}

// siteBestFeatureCoordinate is a somewhat aribtrary heuristic for finding the coordinates for a flying site's "best feature".
//
// What is "best" when panning the map to a flying site? Well, a site is composed of multiple features like launches and landing zones, and between
// its launches and landing zones are a center point that is equidistant betweent all of them. The cener point is not the "best feature" for large sites
// because if the map is zoomed in, the center point may not be within view of _any_ site features. Take "Cove" in Monroe, UT for example. It's center point
// at a zoom level of "14" isn't within view of any of its launches, or its single LZ.
//
// Heurisitic
// - A site's first launch is "the best" (If it has any launches)
// - A site's first LZ is "the best" (If it has any LZs, and no launches)
// - A site's center point is "the best" if it has neither launches or LZs
//
// While sites _should_ have both launches and LZs, if isn't guaranteed to have any, and so the center point is a lost resort to accommodate these instances.
function siteBestFeatureCoordinate(site) {
  // check if members are launches or LZs
  if (site.members.length > 0) {
    const launches= []
    const landingZones= []
    site.members.forEach((member) => {
      const feature = window._features[osmId(member)]
      console.log(feature.tags)
      // features can be both a landing zone and launch, so do not return early upon identifying a launch
      if (feature?.tags['free_flying:takeoff']) {
        launches.push(feature)
      }
      if (feature?.tags['free_flying:landing']) {
        landingZones.push(feature)
      }
    })

    if (launches.length > 0) {
      return boundsCenterPoint(launches[0].bounds)
    }

    if (landingZones.length > 0) {
      return boundsCenterPoint(landingZones[0].bounds)
    }
  }

  // fallback: the site has no members 
  if (site.bounds) {
    return boundsCenterPoint(site.bounds)
  }
}

function multipolygonCenter(feature) {
  if (feature.geomtry) {
    const latlngs = site.geometry.map((pt) => [pt.lat, pt.lon]);
    const bounds = L.polyline(latlngs).getBounds();
    const c = bounds.getCenter();
    return [c.lat, c.lng];
  }

  return null
}

// bestCoordinatte returns the "best" coordinate for a map feature
//
// For points, it is the point's lat/lon
// For feature's with a "center point", it is that feature's center point
// For free flying sites, it is somewhat arbitrarily the site's first launch, if it has one, otherwise its first LZ, otherwise that site's center coordinate (not ideal for large sites)
function bestCoordinate(feature) {
  const isNode = feature.type === "node";
  if (isNode) {
    return [feature.lat, feature.lon];
  } else if (feature.center) {
    return [feature.center.lat, feature.center.lon];
  } else if (feature.geometry) {
    return multipolygonCenter(feature);
  } else {
    return siteBestFeatureCoordinate(feature)
  }
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

  // Initialize map center
  var lastCenter = { lat: lat, lon: lon };

  // initialize the Map object, settings zoomControl to false because we use our own zoom control with a custom
  // position below
  var map = L.map("map", { maxZoom: 18, zoomControl: false }).setView(
    [lastCenter.lat, lastCenter.lon],
    initialZoom,
  );
  window._map = map;

  // Use a custom zoom contrl so it's positioned where we want it on the map, rather than the default position 
  var zoomControl = new L.Control.Zoom({ position: "bottomright" }).addTo(map);

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

  // Movement threshold logic (10% of map size)
  function shouldFetchNewData() {
    const currentCenter = window._map.getCenter();
    const currentZoom = window._map.getZoom();
    const bounds = window._map.getBounds();
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

  // Fetch and update when map stops moving
  map.on("moveend", onViewportChange);
  // map.on('zoomend', onViewportChange);

  // Fetch on load
  fetchParaglidingSites();
}
