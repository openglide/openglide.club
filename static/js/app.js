function loadMap(lat, lon) {
  // The zoom level at which the map initially loads
  const initialZoom = 12;

  // The zoom level at which site geometries are rendered on the map
  const geometryZoom = 14;

  // Initialize map center
  var lastCenter = { lat: lat, lon: lon };

  var map = L.map("map").setView([lastCenter.lat, lastCenter.lon], initialZoom);

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

  // Add layer selector (top-right by default)
  L.control.layers(baseMaps).addTo(map);

  var paraglidingLayer = L.layerGroup().addTo(map);

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
    (
      relation["sport"="free_flying"](${bbox});
      nwr["sport"="free_flying"](${bbox});
    );
    out center tags geom;
  `;
    const url =
      "https://overpass-api.de/api/interpreter?data=" +
      encodeURIComponent(query);

    document.getElementById("siteList").innerHTML =
      "<li class='py-1'>Loading...</li>";

    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        const currentZoom = map.getZoom();

        // 1. Split elements into relations/parents and non-site members
        const elements = data.elements || [];
        const parents = {}; // key = rel id
        const childToParent = {}; // key = nwr id, value = parent rel key

        // First pass: find all site relation elements
        elements.forEach((el) => {
          if (
            el.type === "relation" &&
            el.tags &&
            (el.tags.type === "multipolygon" ||
              el.tags.type === "site" ||
              el.tags.type === "relation")
          ) {
            parents["relation/" + el.id] = {
              el,
              memberKeys: [],
              members: [],
            };
          }
        });

        // Second pass: map all members to their parent, build member lists
        elements.forEach((el) => {
          if (el.type === "relation" && Array.isArray(el.members)) {
            const parentKey = "relation/" + el.id;
            el.members.forEach((m) => {
              const memKey = m.type + "/" + m.ref;
              parents[parentKey].memberKeys.push(memKey);
              childToParent[memKey] = parentKey;
            });
          }
        });

        // 2. List only top-level "sites" (relations) in sidebar, do not include members as top-level
        // If no relations found, fall back to nodes/ways as before
        let sitesForSidebar;
        if (Object.keys(parents).length > 0) {
          // We have parent sites in view
          sitesForSidebar = Object.values(parents).map((p) => {
            const el = p.el;
            const key = "relation/" + el.id;
            const name = el.tags?.name || "(Unnamed site)";
            const osmUrl = "https://www.openstreetmap.org/relation/" + el.id;
            return { key, name, osmUrl, el };
          });
        } else {
          // fallback: nodes/ways in view that aren't members of a relation
          sitesForSidebar = elements
            .filter(
              (el) =>
                (el.type === "node" || el.type === "way") &&
                !childToParent[el.type + "/" + el.id],
            )
            .map((el) => {
              const key = el.type + "/" + el.id;
              const name = el.tags?.name || "(Unnamed paragliding site)";
              const osmUrl = "https://www.openstreetmap.org/" + key;
              return { key, name, osmUrl, el };
            });
        }

        // 3. Prepare all features for rendering on map but mark which ones belong to a parent
        // Add marker/geometry for all elements, but record if it's a parent or a child
        const markerOrLayerByKey = {};

        elements.forEach((el) => {
          const key = el.type + "/" + el.id;
          const isParent = !!parents[key];
          const isChild = !!childToParent[key];

          // Only show marker if: (a) it's not a member of a parent, or (b) it's a parent relation itself, or (c) fallback non-relation mode
          if (isChild && !isParent) {
            // Don't render individual child markers/geometry until their parent is selected
            return;
          }

          // Marker/geometry drawing
          const name = el.tags?.name || "(Unnamed)";
          let tagInfo = "";
          if (el.tags) {
            tagInfo = Object.entries(el.tags)
              .map(([k, v]) => `<b>${k}:</b> ${v}`)
              .join("<br>");
          }
          const osmUrl = "https://www.openstreetmap.org/" + key;
          const popupContent = `
          <b>${name}</b><br>
          <a href="${osmUrl}" target="_blank">View on OSM</a>
          ${tagInfo ? "<br>" + tagInfo : ""}
        `;

          const isNode = el.type === "node";
          const center = elementCenter(el);
          const showMarker = isNode || (!isNode && currentZoom < geometryZoom);
          const showGeom =
            !isNode &&
            currentZoom >= geometryZoom &&
            Array.isArray(el.geometry);

          if (showMarker && center) {
            const m = L.marker(center)
              .bindPopup(popupContent)
              .addTo(paraglidingLayer);
            markerOrLayerByKey[key] = m;
          } else if (showGeom) {
            const coords = el.geometry.map((pt) => [pt.lon, pt.lat]);
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
              onEachFeature: (_, lyr) => lyr.bindPopup(popupContent),
            }).addTo(paraglidingLayer);

            markerOrLayerByKey[key] = layer;
          }
        });

        // Store associations for sidebar selection
        window._PG_siteMembersData = { parents, markerOrLayerByKey, elements };

        updateSiteList(sitesForSidebar);
        lastCenter = map.getCenter();
        lastZoom = map.getZoom();
      })
      .catch((err) => {
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
    // console.log("fetch new data?", shouldFetch, "current zooom", currentZoom, "current center", currentCenter, "last center", lastCenter)
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
      var li = document.createElement("li");
      li.textContent = site.name;
      li.title = "Click to show on map";
      li.className =
        "py-1 pl-0.5 pr-1 hover:bg-blue-50 border-b border-gray-200 cursor-pointer flex items-center justify-between";
      li.onclick = function () {
        onSiteSelected(site.key);
      };
      // Optional: Add a "view on osm" link beside the name
      var osmA = document.createElement("a");
      osmA.href = site.osmUrl;
      osmA.target = "_blank";
      osmA.textContent = "↗";
      osmA.className = "site-link text-blue-700 hover:underline ml-2";
      osmA.onclick = function (e) {
        e.stopPropagation();
      };
      li.appendChild(osmA);
      list.appendChild(li);
    });
  }

  // Fetch and update when map stops moving
  map.on("moveend", onViewportChange);
  // map.on('zoomend', onViewportChange);

  // Fetch on load
  fetchParaglidingSites();
}
