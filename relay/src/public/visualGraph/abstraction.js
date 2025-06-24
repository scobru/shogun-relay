/**
 * Abstraction layer for building labeled property graphs
 * This module provides utilities for working with graph data structures
 */

(function(global) {
  'use strict';

  var Abstraction = {};

  /**
   * Creates a graph abstraction with nodes and edges
   * @param {Object} config Configuration object
   * @returns {Object} Graph abstraction object
   */
  Abstraction.createGraph = function(config) {
    config = config || {};
    
    return {
      nodes: new Map(),
      edges: new Map(),
      
      addNode: function(id, data) {
        if (!id) throw new Error('Node ID is required');
        this.nodes.set(id, {
          id: id,
          data: data || {},
          label: data?.label || id
        });
        return this;
      },
      
      addEdge: function(source, target, data) {
        if (!source || !target) throw new Error('Source and target are required');
        var edgeId = source + '->' + target;
        this.edges.set(edgeId, {
          id: edgeId,
          source: source,
          target: target,
          data: data || {}
        });
        return this;
      },
      
      getNode: function(id) {
        return this.nodes.get(id);
      },
      
      getEdge: function(source, target) {
        var edgeId = source + '->' + target;
        return this.edges.get(edgeId);
      },
      
      getAllNodes: function() {
        return Array.from(this.nodes.values());
      },
      
      getAllEdges: function() {
        return Array.from(this.edges.values());
      },
      
      clear: function() {
        this.nodes.clear();
        this.edges.clear();
        return this;
      },
      
      size: function() {
        return {
          nodes: this.nodes.size,
          edges: this.edges.size
        };
      }
    };
  };

  /**
   * Utility functions for property graph operations
   */
  Abstraction.utils = {
    /**
     * Converts a Gun.js node to graph format
     * @param {Object} gunNode Gun.js node data
     * @param {String} soul Node soul/ID
     * @returns {Object} Normalized node object
     */
    normalizeGunNode: function(gunNode, soul) {
      if (!gunNode) return null;
      
      var normalized = {
        id: soul || Gun.node.soul(gunNode),
        properties: {},
        references: {}
      };
      
      Object.keys(gunNode).forEach(function(key) {
        if (key === '_') return; // Skip metadata
        
        var value = gunNode[key];
        if (value && typeof value === 'object' && value['#']) {
          // This is a reference to another node
          normalized.references[key] = value['#'];
        } else if (value != null) {
          // This is a regular property
          normalized.properties[key] = value;
        }
      });
      
      return normalized;
    },
    
    /**
     * Creates a label from node properties
     * @param {Object} nodeData Node data object
     * @param {String} labelProperty Primary property to use as label
     * @returns {String} Generated label
     */
    createLabel: function(nodeData, labelProperty) {
      if (!nodeData) return 'Unknown';
      
      // Try to use the specified label property
      if (labelProperty && nodeData.properties && nodeData.properties[labelProperty]) {
        return String(nodeData.properties[labelProperty]);
      }
      
      // Fallback to common label properties
      var commonLabels = ['name', 'title', 'label', 'id'];
      for (var i = 0; i < commonLabels.length; i++) {
        var prop = commonLabels[i];
        if (nodeData.properties && nodeData.properties[prop]) {
          return String(nodeData.properties[prop]);
        }
      }
      
      // Use the node ID as fallback
      return nodeData.id || 'Unknown';
    },
    
    /**
     * Validates graph data structure
     * @param {Object} graph Graph object with nodes and edges
     * @returns {Object} Validation result
     */
    validateGraph: function(graph) {
      var result = {
        valid: true,
        errors: [],
        warnings: []
      };
      
      if (!graph) {
        result.valid = false;
        result.errors.push('Graph object is null or undefined');
        return result;
      }
      
      if (!graph.nodes || !Array.isArray(graph.nodes)) {
        result.valid = false;
        result.errors.push('Graph must have a nodes array');
      }
      
      if (!graph.edges || !Array.isArray(graph.edges)) {
        result.valid = false;
        result.errors.push('Graph must have an edges array');
      }
      
      if (result.valid) {
        // Check for orphaned edges
        var nodeIds = new Set(graph.nodes.map(function(n) { return n.id; }));
        graph.edges.forEach(function(edge, index) {
          if (!nodeIds.has(edge.source)) {
            result.warnings.push('Edge ' + index + ' references unknown source node: ' + edge.source);
          }
          if (!nodeIds.has(edge.target)) {
            result.warnings.push('Edge ' + index + ' references unknown target node: ' + edge.target);
          }
        });
      }
      
      return result;
    }
  };

  // Export to global scope
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Abstraction;
  } else {
    global.Abstraction = Abstraction;
  }

})(typeof window !== 'undefined' ? window : this); 