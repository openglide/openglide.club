// A marker on the map for the search results
var searchMarker = null;

async function showSearchSuggestions() {
  const searchField = document.getElementById("searchInput");
  const suggestionsBox = document.getElementById("search_suggestions");
  let query = searchField.value.trim();

  // Hide if empty
  if (!query) {
    suggestionsBox.style.display = "none";
    suggestionsBox.innerHTML = "";
    return;
  }

  // Check for coordinate format (only support decimal, not DMS or other formats)
  // Accept "-12.5, 32.1" and variations with whitespace
  let coordMatch = query.match(/^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*$/);
  if (coordMatch) {
    // Only show one suggestion for the entered coordinates
    let lat = parseFloat(coordMatch[1]);
    let lng = parseFloat(coordMatch[3]);

    // Clamp or skip obviously invalid values if desired
    let item = document.createElement("div");
    item.className = "px-2 py-1 hover:bg-blue-50 cursor-pointer text-gray-900";
    item.textContent = `Go to coordinates: ${lat}, ${lng}`;
    item.onclick = () => {
      // Redirect to correct /map url
      // centerMapAndAddMarker(lat, lng);
      suggestionsBox.style.display = "none";
      suggestionsBox.innerHTML = "";
    };
    suggestionsBox.innerHTML = "";
    suggestionsBox.appendChild(item);
    suggestionsBox.style.display = "block";
    return;
  }

  // Otherwise, call Nominatim to get suggestions
  var nominatimUrl =
    "https://nominatim.openstreetmap.org/search?format=json&q=" +
    encodeURIComponent(query);
  fetch(nominatimUrl)
    .then((res) => res.json())
    .then((data) => {
      suggestionsBox.innerHTML = "";
      if (!data || !data.length) {
        let item = document.createElement("div");
        item.className = "px-2 py-1 text-gray-500";
        item.textContent = `No results found for "${query}"`;
        suggestionsBox.appendChild(item);
      } else {
        data.slice(0, 8).forEach((result) => {
          let lat = parseFloat(result.lat);
          let lng = parseFloat(result.lon);
          let name = result.display_name || `${lat},${lng}`;
          let item = document.createElement("div");
          item.className = "px-2 py-1 hover:bg-blue-50 cursor-pointer truncate";
          item.title = result.display_name;
          item.innerHTML = `<span class="font-medium">${name}</span>`;
          item.onclick = () => {
            suggestionsBox.style.display = "none";
            suggestionsBox.innerHTML = "";
            window.location = `/map?lat=${lat}&lon=${lng}`;
          };
          suggestionsBox.appendChild(item);
        });
      }
      suggestionsBox.style.display = "block";
    })
    .catch((err) => {
      suggestionsBox.innerHTML =
        '<div class="px-2 py-1 text-red-500">Error fetching results</div>';
      suggestionsBox.style.display = "block";
    });
}

// Hide suggestions when clicking outside
document.addEventListener("click", function (e) {
  const suggestionsBox = document.getElementById("search_suggestions");
  const searchBox = document.getElementById("search_box");
  if (searchBox == null) {
    return;
  }
  if (!searchBox.contains(e.target)) {
    suggestionsBox.style.display = "none";
    suggestionsBox.innerHTML = "";
  }
});

async function doSearch() {
  var query = searchField.value.trim();
  if (!query) return;

  const searchField = document.getElementById("searchInput");
  const suggestionsBox = document.getElementById("search_suggestions");

  // Coordinate match as before
  let coordMatch = query.match(/^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*$/);
  if (coordMatch) {
    let lat = parseFloat(coordMatch[1]);
    let lng = parseFloat(coordMatch[3]);
    centerMapAndAddMarker(lat, lng);
    suggestionsBox.style.display = "none";
    suggestionsBox.innerHTML = "";
    return;
  }

  // Otherwise, do Nominatim and use first result
  var nominatimUrl =
    "https://nominatim.openstreetmap.org/search?format=json&q=" +
    encodeURIComponent(query);
  fetch(nominatimUrl)
    .then((response) => response.json())
    .then((data) => {
      if (data && data.length > 0) {
        var lat = parseFloat(data[0].lat);
        var lng = parseFloat(data[0].lon);
        centerMapAndAddMarker(lat, lng);
      } else {
        alert('No results found for "' + query + '".');
      }
      suggestionsBox.style.display = "none";
      suggestionsBox.innerHTML = "";
    })
    .catch((err) => {
      console.error("Error during Nominatim fetch: ", err);
      suggestionsBox.style.display = "none";
      suggestionsBox.innerHTML = "";
    });
}

function centerMapAndAddMarker(lat, lng) {
  map.setView([lat, lng], 12, { animate: true });
  if (searchMarker) {
    map.removeLayer(searchMarker);
  }
  searchMarker = L.marker([lat, lng]).addTo(map);
}
