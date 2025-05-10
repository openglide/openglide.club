window.openDrawer = function (contentHtml) {
  var drawer = document.getElementById("infoDrawer");
  var content = document.getElementById("drawerContent");
  content.innerHTML = contentHtml;
  drawer.style.display = "block";
  setTimeout(() => {
    drawer.classList.add("open");
  }, 10); // allow for transition
};

window.closeDrawer = function () {
  var drawer = document.getElementById("infoDrawer");
  drawer.classList.remove("open");
  setTimeout(() => {
    drawer.style.display = "none";
  }, 300); // match CSS duration
};

// panToFeatures pans the map view to the specified feature
function panToFeature(el) {
  const center = elementCenter(el);
  console.log("got center", center);
  if (center && map) {
    window._map.setView(center, Math.max(window._map.getZoom(), 14), {
      animate: true,
    });
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
  console.log("el", el);
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

  var map = L.map("map", { maxZoom: 21 }).setView(
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

  // make osm the default tile set
  osm.addTo(map);

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
    const childToParent = {}; // key = child OSM id, value = parent rel key

    // First pass: find all "sites", i.e. sites that contain one or more free flying features like landing zones or launches
    elements
      .filter((el) => isSite(el))
      .forEach((el) => {
        parents["relation/" + el.id] = {
          el,
          memberKeys: [],
          members: [],
        };
      });

    // Second pass: map all members to their parent, build member lists
    elements
      .filter((el) => isSite(el) && hasMembers(el))
      .map((el) => {
        const parentKey = "relation/" + el.id;
        el.members.forEach((m) => {
          const memKey = m.type + "/" + m.ref;
          parents[parentKey].memberKeys.push(memKey);
          childToParent[memKey] = parentKey;
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
    standaloneSites = elements
      .filter((el) => !childToParent[el.type + "/" + el.id] && !isSite(el))
      .map((el) => {
        const key = el.type + "/" + el.id;
        const name = el.tags?.name || "(Unnamed paragliding site)";
        const osmUrl = "https://www.openstreetmap.org/" + key;
        return { key, name, osmUrl, el };
      });
    sidebarSites = sidebarSites.concat(standaloneSites);

    // 3. Prepare all features for rendering on map but mark which ones belong to a parent
    // Add marker/geometry for all elements, but record if it's a parent or a child
    const markerOrLayerByKey = {};
    const generateDrawerContent = (el, osmUrl) => {
      let tagInfo = "";
      if (el.tags) {
        tagInfo =
          `<table class="w-full mt-2">` +
          Object.entries(el.tags)
            .map(
              ([k, v]) =>
                `<tr><td class="font-bold p-1">${k}</td><td class="p-1">${v}</td></tr>`,
            )
            .join("") +
          `</table>`;
      }
      return `
    <div>
      <h3 class="text-xl font-bold mb-2">${el.tags?.name || "(Unnamed site/feature)"}</h3>
      <a href="${osmUrl}" target="_blank" class="text-blue-700 underline mb-4 inline-block">View on OpenStreetMap</a>
      ${tagInfo}
    </div>
  `;
    };
    elements.forEach((el) => {
      const key = el.type + "/" + el.id;
      const isParent = !!parents[key];
      const isChild = !!childToParent[key];

      // // Only show marker if: (a) it's not a member of a parent, or (b) it's a parent relation itself, or (c) fallback standalone site mode
      // if (isChild && !isParent) {
      //   // Don't render individual child markers/geometry until their parent is selected
      //   return;
      // }

      // Marker/geometry drawing
      const name = el.tags?.name || "(Unnamed)";
      let tagInfo = "";
      if (el.tags) {
        tagInfo = Object.entries(el.tags)
          .map(([k, v]) => `<b>${k}:</b> ${v}`)
          .join("<br>");
      }
      const osmUrl = "https://www.openstreetmap.org/" + key;
      const isNode = el.type === "node";
      const center = elementCenter(el);
      const showMarker = isNode || (!isNode && currentZoom < geometryZoom);
      const showGeom =
        !isParent && !isNode && currentZoom >= geometryZoom && getGeometry(el);

      if (showMarker && center) {
        const m = L.marker(center)
          .addTo(paraglidingLayer)
          .on("click", function () {
            openDrawer(generateDrawerContent(el, osmUrl));
          });
        markerOrLayerByKey[key] = m;
      } else if (showGeom) {
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
          style: { color: isParent ? "#0077cc" : "#aa3311", weight: 3 },
          onEachFeature: (_, lyr) => {
            lyr.on("click", function () {
              openDrawer(generateDrawerContent(el, osmUrl));
            });
          },
        }).addTo(paraglidingLayer);

        markerOrLayerByKey[key] = layer;
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
      list.innerHTML =
        "<li class='py-1'>No paragliding site found in view.</li>";
      return;
    }
    list.innerHTML = "";
    sites.forEach(function (site) {
      var el = document.createElement("a");
      el.href = "#";
      el.textContent = site.name;
      el.title = "Click to show on map";
      el.className =
        "py-1 pl-0.5 pr-1 hover:bg-blue-50 border-b border-gray-200 cursor-pointer flex items-center justify-between";
      el.onclick = function () {
        panToFeature(site.el);
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
