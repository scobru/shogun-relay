/* SECTION: D3 functionality */

function dragstarted(d) {
  if (!d3.event.active) simulation.alphaTarget(0.3).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(d) {
  d.fx = d3.event.x;
  d.fy = d3.event.y;
}

function dragended(d) {
  if (!d3.event.active) simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}

function ticked() {
  if (link) {
    link
        .attr("x1", function(d) { return d.source.x; })
        .attr("y1", function(d) { return d.source.y; })
        .attr("x2", function(d) { return d.target.x; })
        .attr("y2", function(d) { return d.target.y; });
  }

  if (node) {
    node
        .attr("cx", function(d) { return d.x; })
        .attr("cy", function(d) { return d.y; });
  }

  if (label) {
    label
        .attr("x", function(d) { return d.x + 5; })
        .attr("y", function(d) { return d.y + 3; });
  }
}

function makeLabel(data) {
  if (!data || typeof data !== 'object') return '';
  
  var entries = Object.entries(data);
  var string = '';
  
  for (var i = 0; i < entries.length; i++) {
    var key = entries[i][0];
    var value = entries[i][1];
    
    if (key !== '_' && value != null) {
      string += key + ' : ' + value + " // ";
    }
  }
  return string;
}

// INITIALIZING D3 and GLOBALS

var svg = d3.select("svg");
var width = +svg.attr("width");
var height = +svg.attr("height");
var link;
var node;
var label;
var highlightSize = 5;
var normalSize = 3;

// Create a container group for zoom transforms
var container = svg.append("g");

var zoom = d3.zoom()
  .scaleExtent([0.1, 10])
  .on("zoom", function() {
    var transform = d3.event.transform;
    container.attr("transform", transform);
  });

svg.call(zoom);

var color = d3.scaleOrdinal(d3.schemeCategory10);

var simulation = d3.forceSimulation()
  .force("link", d3.forceLink().id(function(d) { return d.id; }).distance(100))
  .force("center", d3.forceCenter(width/2, height/2))
  .force("charge", d3.forceManyBody().strength(-300))
  .force("collision", d3.forceCollide().radius(20));

function update() {
  console.log('Updating visualization with', window.graph?.nodes?.length || 0, 'nodes and', window.graph?.edges?.length || 0, 'edges');
  
  if (!window.graph || !window.graph.nodes || !window.graph.edges) {
    console.error('Graph data is not properly initialized');
    return;
  }

  // Clear previous elements
  container.selectAll('*').remove();
  
  // Create links
  link = container.append("g")
    .attr("class", "links")
    .selectAll("line")
    .data(window.graph.edges)
    .enter().append("line")
    .attr("stroke", "#999")
    .attr("stroke-opacity", 0.6)
    .attr("stroke-width", 1);

  // Create nodes
  node = container.append("g")
    .attr("class", "nodes")
    .selectAll("circle")
    .data(window.graph.nodes)
    .enter().append("circle")
    .attr("id", function(d) { return d.id; })
    .attr("r", normalSize)
    .attr("fill", "rgb(120,0,0)")
    .call(d3.drag()
      .on("start", dragstarted)
      .on("drag", dragged)
      .on("end", dragended))
    .on("click", detail);

  // Add tooltips
  node.append("title")
    .text(function(d) { return d.id ? d.id.toUpperCase() : 'Unknown'; });

  // Create labels
  label = container.append("g")
    .attr("class", "labels")
    .selectAll("text")
    .data(window.graph.nodes)
    .enter().append("text")
    .text(function(d) { 
      if (d.label) {
        return d.label.length > 20 ? d.label.substring(0, 20) + '...' : d.label.toUpperCase();
      }
      return '';
    })
    .attr("font-size", "10px")
    .attr("fill", "#333");

  // Update simulation
  simulation.nodes(window.graph.nodes)
    .on("tick", ticked);

  simulation.force("link")
    .links(window.graph.edges);

  simulation.alpha(1).restart();
  
  // Cool down after some time
  setTimeout(coolIt, 2000);
}

var coolIt = function() {
  simulation.alphaTarget(0);
}

/* SECTION: Graph Inspector */

var previousNode;

function detail(d, i, nodes) {
  var key, element;
  
  // Handle both direct calls and event-based calls
  if (typeof d === 'object' && d.id) {
    key = d.id;
    element = nodes ? nodes[i] : document.getElementById(key);
  } else if (d && d.target && d.target.id) {
    key = d.target.id;
    element = d.target;
  } else {
    console.error('Invalid detail call', d);
    return;
  }

  // Reset previous node highlighting
  if (previousNode) {
    try {
      previousNode.setAttribute('r', normalSize);
    } catch (e) {
      console.log('Could not reset previous node:', e);
    }
  }

  // Highlight current node
  if (element) {
    element.setAttribute('r', highlightSize);
    previousNode = element;
  }

  // Fetch and display node data
  if (window.gun && key) {
    console.log('Fetching data for key:', key);
    window.gun.get(key).once((data, nodeKey) => {
      console.log('Received data for key:', key, 'Data:', data);
      
      var hasActualData = data && Object.keys(data).some(k => k !== '_' && data[k] != null);

      if (hasActualData) {
        displayNodeData(data, key);
      } else {
        // Data from .once() is empty or meta-only, let's try .map() for edges.
        console.log('No direct data, trying .map() for key:', key);
        const mapData = {};
        if(data && data._){
          mapData._ = data._; // Preserve metadata if it exists
        }
        let foundMapData = false;
        
        const keyNode = window.gun.get(key);
        keyNode.map().once(function(val, prop) {
          if (typeof val !== 'undefined' && val !== null) {
            foundMapData = true;
            mapData[prop] = val;
          }
        });

        setTimeout(() => {
          if (foundMapData) {
            console.log('Found map data for key:', key, mapData);
            displayNodeData(mapData, key);
          } else {
            console.log('No map data found either for key:', key);
            displayNodeData(data, key); // Show original (empty) data
          }
        }, 300); // Wait a bit for map to resolve
      }
    });
  } else {
    console.error('Gun instance not available or key is empty');
  }
}

function displayNodeData(data, key) {
  var detailContainer = document.getElementById('detail');
  if (!detailContainer) {
    console.error('Detail container not found');
    return;
  }

  console.log('displayNodeData called with:', { data, key, dataType: typeof data });

  if (!data) {
    detailContainer.innerHTML = "<div class='contV'><h3>Data Inspector</h3><p>No data found for key: " + key + "</p></div>";
    return;
  }

  // Check if data is an empty object
  var dataKeys = Object.keys(data);
  var hasActualData = dataKeys.some(k => k !== '_' && data[k] != null);
  console.log('Data keys:', dataKeys, 'Has actual data:', hasActualData);

  if (!hasActualData) {
    detailContainer.innerHTML = "<div class='contV'><h3>Data Inspector</h3><p>Empty data for key: " + key + "</p><pre>" + JSON.stringify(data, null, 2) + "</pre></div>";
    return;
  }

  var soul = Gun.node.soul(data) || key;
  var properties = Object.keys(data);
  var html = "<div class='contV'><h3>Data Inspector</h3>";
  html += "<div class='item'>SOUL: <span id='soul'>" + soul + "</span>";
  html += "<div class='contV'>";

  for (var prop of properties) {
    if (prop !== "_" && data[prop] != null) {
      html += "<div class='prop'>PROP: " + prop;

      if (typeof data[prop] === 'object' && data[prop]['#']) {
        // Reference to another node
        html += " VALUE: <span class='link'";
        html += " id='" + data[prop]['#'] + "'";
        html += " onclick='detail({id:\"" + data[prop]['#'] + "\"})'>" + data[prop]['#'];
        html += "</span>";
      } else {
        // Regular value
        var value = String(data[prop]).replace(/"/g, '&quot;');
        html += " VALUE: <input id='" + prop + "' value=\"" + value + "\">";
      }
      html += "</div>";
    }
  }

  html += "</div></div></div>";
  console.log('Generated HTML:', html);
  detailContainer.innerHTML = html;
}

function saveDetail() {
  var items = document.getElementsByClassName("item");
  if (!items.length) {
    console.log('No items to save');
    return;
  }

  for (var item of items) {
    try {
      var soulElement = item.querySelector('#soul');
      if (!soulElement) continue;
      
      var soul = soulElement.textContent;
      var propElements = item.querySelectorAll('.prop input');
      
      for (var input of propElements) {
        if (input.id && input.value !== undefined) {
          window.gun.get(soul).get(input.id).put(input.value);
          console.log('Saved:', soul, input.id, input.value);
        }
      }
    } catch (error) {
      console.error('Error saving item:', error);
    }
  }

  // Refresh the visualization
  var key = document.getElementById('key')?.value;
  var label = document.getElementById('label')?.value;
  if (key && window.DFS && window.DFS.search) {
    console.log('Refreshing visualization...');
    window.DFS.search(key, label);
  }
}

// Initialize save button
document.addEventListener('DOMContentLoaded', function() {
  var saveButton = document.getElementById('save');
  if (saveButton) {
    saveButton.addEventListener("click", saveDetail);
  }
});

/* SECTION: DFS functionality */

var DFS = (function(){
  var stack;
  var nodes;
  var edges;
  var start;
  var u;
  var label;
  var opt = false;
  var stop = false;
  var limit = 500;
  var visitedCount = 0;

  var util = {};

  util.printMap = function(map) {
    var array = Array.from(map);
    for (var i = 0; i < array.length; i++) {
      console.log(array[i][1]);
    }
  }

  util.printArr = function(array) {
    for (var i = 0; i < array.length; i++) {
      console.log(array[i]);
    }
  };

  util.makeNodes = function(map) {
    var array = Array.from(map);
    var nodes = [];
    for (var i = 0; i < array.length; i++) {
      nodes.push(array[i][1]);
    }
    return nodes;
  };

  util.makeEdges = function(map) {
    var array = Array.from(map);
    var edges = [];
    for (var i = 0; i < array.length; i++) {
      edges.push(array[i][1]);
    }
    return edges;
  };

  var dfs = {};

  dfs.search = function(soul, lbl, lim) {
    console.log('Starting DFS with soul:', soul);
    
    if (!soul) {
      console.error('No soul provided for DFS search');
      return;
    }

    if (!window.gun) {
      console.error('Gun instance not available for DFS search');
      return;
    }

    // Reset state
    opt = !!lbl;
    label = lbl;
    start = soul;
    stack = [];
    nodes = new Map();
    edges = new Map();
    stop = false;
    visitedCount = 0;
    
    if (lim) limit = lim;
    
    console.log('DFS configuration:', { soul, label, limit, opt });
    
    // Start the search
    window.gun.get(soul).once(dfs.node);
  };

  dfs.node = function(node, key) {
    if (stop) return;
    
    visitedCount++;
    console.log('Visiting node:', key, 'Count:', visitedCount);
    
    if (!node) {
      console.error('No data for key:', key);
      dfs.back();
      return;
    }

    var soul = Gun.node.soul(node) || key;
    
    if (soul === start) {
      stack.push(soul);
    }

    u = node;
    
    // Create node entry
    var nodeData = { id: soul, label: key };
    if (opt && node[label]) {
      nodeData.label = node[label];
    }
    
    nodes.set(soul, nodeData);
    dfs.edge(u, edges);
  };

  dfs.edge = function(node, edges) {
    if (stop || visitedCount >= limit) {
      console.log('Stopping DFS - reached limit or stop condition');
      dfs.render();
      return;
    }

    var soul = Gun.node.soul(node);
    var properties = Object.keys(node);
    var nextRef = null;

    // Find the next unvisited reference
    for (var prop of properties) {
      if (prop === "_" || node[prop] == null) continue;
      
      if (typeof node[prop] === 'object' && node[prop]['#']) {
        var targetSoul = node[prop]['#'];
        var edgeKey = soul + targetSoul;
        
        if (!edges.has(edgeKey)) {
          nextRef = node[prop];
          break;
        }
      }
    }

    if (nextRef) {
      dfs.next(nextRef, soul, nextRef['#']);
    } else {
      if (start === soul) {
        stack.pop();
      }
      dfs.back();
    }
  };

  dfs.next = function(next, edgeSource, edgeTarget) {
    if (stop) return;
    
    var targetSoul = next['#'];
    
    // Add edge
    edges.set(edgeSource + edgeTarget, {
      source: edgeSource,
      target: edgeTarget
    });
    
    // Add target node if not exists
    if (!nodes.has(targetSoul)) {
      nodes.set(targetSoul, { id: targetSoul, label: targetSoul });
    }
    
    stack.push(targetSoul);
    
    if (visitedCount >= limit) {
      console.info('Reached node limit:', limit);
      dfs.render();
      return;
    }
    
    // Continue search
    window.gun.get(targetSoul).once(dfs.node);
  };

  dfs.back = function() {
    if (stack.length === 0) {
      dfs.render();
    } else {
      var soul = stack.pop();
      window.gun.get(soul).once(dfs.node);
    }
  };

  dfs.render = function() {
    console.log('Rendering graph with', nodes.size, 'nodes and', edges.size, 'edges');
    
    if (!window.graph) {
      window.graph = { nodes: [], edges: [] };
    }
    
    window.graph.nodes = util.makeNodes(nodes);
    window.graph.edges = util.makeEdges(edges);
    
    // Update the visualization
    update();
  };

  return dfs;
})();

// Make DFS globally available
window.DFS = DFS;

/* SECTION: BFS functionality (disabled for now) */
// The BFS section has been commented out as it was incomplete and causing issues
// It can be re-enabled and fixed later if needed

/*
var bfs = (async function () {
  // BFS implementation would go here
  // Currently disabled due to incomplete implementation
})(root = gun);
*/
