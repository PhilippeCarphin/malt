var d3scale = require("d3-scale");
var extend = require("extend");
var union = require('lodash.union');
var SimpleIdCache = require("./SimpleIdCache.js");
var MaltHelper = require("../client-files/app/js/helper.js");
var MaltFuncMetrics = require("../client-files/app/js/func-metrics.js");
var CppDeclParser = require("./CppDeclParser.js");

/**
 * Malt helper class object
 * @type {MaltHelper}
 */
var maltHelper = new MaltHelper();
var maltFuncMetrics = new MaltFuncMetrics();

/**
 * An adapter class that encapsulates a stack-tree and exposes
 * it as nodes and edges, suitable for making a calltree graph.
 * 
 * @param {object} stacktree Stack tree object
 */
function CallTreeAdapter(stacktree)
{

	/**
	 * Creates a cost filter function
	 * @param {float} cost   Cost to be used for comparison
	 * @param {string} metric Type of metric; determines whether we need > or < comparison
	 */
	function CostFilter(cost, minMax, metric) {
		var comparators = {
			lt: function(left, right) {
				return left <= right;
			},
			gt: function(left, right) {
				return left >= right;
			}
		};

		var minima = minMax[0], maxima = minMax[1], costValue;
		var comparator = maltFuncMetrics.maltMetrics[metric].defaultOrder == 'asc' ? comparators.lt : comparators.gt;

		if(minMax.length == 3) {
			minima = maltFuncMetrics.maltMetrics[metric].defaultOrder == 'asc' ? minMax[1] : minMax[0];
			maxima = maltFuncMetrics.maltMetrics[metric].defaultOrder == 'asc' ? minMax[2] : minMax[1];
		}

		if(maltFuncMetrics.maltMetrics[metric].defaultOrder == 'asc') {
			costValue = maxima - (maxima - minima) * (cost / 100.0);
		} else {
			costValue = (maxima - minima) * (cost / 100.0) + minima;
		}

		return function(value) {
			return comparator(value, costValue);
		}
	}

	/**
	 * Reduce child and parent statistics
	 * @param  {object} node Child node
	 * @param  {object} info Parent node info
	 */
	function reduceStat(node,info)
	{
		if(node.info == undefined)
			node.info = extend(true, {}, info);
		else
			maltHelper.mergeStackInfoDatas(node.info,info);
	}

	/**
	 * Builds a hierarchical call tree from a stack tree
	 * @param  {object} data Stack tree data
	 * @return {object}      Call tree
	 */
	function buildCallTree(data)
	{
		var tree = {childs:{},id:null};
		var id = 0;
		for(var i in data) {
			var call = data[i];
			var cur = tree;
			reduceStat(cur,call.info);
			for (var i = call.stack.length - 1; i >= 0; i--) {
				var loc = call.stack[i];
				if (cur.childs[loc.function] == undefined)
					cur.childs[loc.function] = {childs:{},id:id++,location:loc};
				cur = cur.childs[loc.function];
				reduceStat(cur,call.info);
			}
		}
		
		return tree;
	}

	/**
	 * Creates identifier from a location object for a function
	 * @param  {object} location Location object for a function
	 * @return {string}          Identifier
	 */
	function getIdentifier(location) 
	{
		if(!location)
			return null;

		return location.function;
	}

	/**
	 * Traverse call tree and generate nodes and edges
	 * @param  {object} tree      Hierarchical Call-tree object
	 * @param  {int} level        Current depth
	 * @param  {array} nodes      Nodes array
	 * @param  {array} vertices   Edges array
	 * @param  {SimpleIdCache} nodeCache Cache to track node ids
	 * @param  {SimpleIdCache} vertCache Cache to track edge
	 * @return {int}              Id for current tree
	 */
	function generateNodesAndVertices(parent, tree, level, nodes, vertices, nodeCache, vertCache)
	{
		var identifier = null;
		var currentId = null;


		if(tree.location) {
			// Remove libmalt.so related functions captured in call tree
			// if(tree.location.binary.endsWith("libmalt.so"))
			// 	return null;

			// Remove useless nodes
			if(tree.info.alloc.count == 0)
				return null;

			identifier = getIdentifier(tree.location);

			// Add node to node-list if this is a new node
			if(!nodeCache.exists(identifier)) {
				currentId = nodeCache.put(identifier);
				nodes.push({
					id: currentId,
					label: CppDeclParser.getShortName(CppDeclParser.parseCppPrototype(tree.location.function)),
					tooltip: tree.location.function,
					level: level,
					stats: extend(true, {}, tree.info),
					data: tree,
					outEdges: [],
					inEdges: []
				});
			} else {
				currentId = nodeCache.get(identifier);
				// console.log(parent, currentId);
				if(parent != currentId)
					maltHelper.mergeStackInfoDatas(nodes[currentId - 1].stats, tree.info);
			}
		} 

		// Create edge from this node to all its children
		for (var i in tree.childs) {
			if(identifier !=  null) {
				var childId = generateNodesAndVertices(currentId, tree.childs[i], level + 1, nodes, vertices, nodeCache, vertCache);
				if(childId != null && !vertCache.exists(currentId + "," + childId)) {
					vertCache.put(currentId + "," + childId);
					nodes[currentId-1].outEdges.push(childId);
					nodes[childId-1].inEdges.push(currentId);
					vertices.push({
						from: currentId,
						to: childId
					});					
				}
			} else {
				generateNodesAndVertices(null, tree.childs[i], level + 1, nodes, vertices, nodeCache, vertCache);
			}
		}

		return currentId;
	}

	/**
	 * Convert a call tree to a object containing nodes and vertices
	 * @param  {object} tree Call-tree
	 * @return {object}      Contains nodes and edges
	 */
	function generateTreeDataSet(tree) 
	{
		var nodes = [], vertices= [];
		generateNodesAndVertices(null, tree, 0, nodes, vertices, new SimpleIdCache(), new SimpleIdCache());

		return {
			nodes: nodes, 
			edges: vertices
		};
	}

	/**
	 * Convert RGB string to HEX color string
	 * @param  {string} rgb RGB color string
	 * @return {string}     HEX color string
	 */
	function convertRgbStringToHex(rgb) {
		var a = rgb.split("(")[1].split(")")[0];
		a = a.split(",");
		var b = a.map(function(x){             //For each array element
		    x = parseInt(x).toString(16);      //Convert to a base16 string
		    return (x.length==1) ? "0"+x : x;  //Add zero if we get only one character
		})
		return "#"+b.join("");
	}

	/**
	 * Calculates color codes for nodes based on a metric
	 *
	 * Color is added as the 'color' property on each node
	 * 
	 * @param {dataset} dataset Call-Tree dataset
	 */
	function addColorCodes(dataset) {
		var nodes = dataset.nodes;
		var max = -1;

		// find max
		for (var i = 0; i < nodes.length; i++) {
			if(nodes[i].score > max) {
				max = nodes[i].score;
			}
		}

		// generate a mapping function from [0-max] onto [#397EBA,#FF9595]
		var colorScale = d3scale.scaleLinear()
			.range(["#397EBA","#ab4141"])
			.domain([0,max]);

		// assign colors
		for (var i = 0; i < nodes.length; i++) {
			nodes[i].color = convertRgbStringToHex(colorScale(nodes[i].score));
		}
	}

	/**
	 * Add score attribute to nodes
	 * @param {array} nodes  Node list
	 * @param {string} metric Type of metric to use as score
	 * @param {boolean} isRatio Should the score be calculated as percentages?
	 */
	function addScores(nodes, metric, isRatio) {
		if(isRatio) {
			var max = -1;
			for (var i = 0; i < nodes.length; i++) {
				if(maltFuncMetrics.maltMetrics[metric].extractor(nodes[i].stats) > max)
					max = maltFuncMetrics.maltMetrics[metric].extractor(nodes[i].stats);
			}
			for (var i = 0; i < nodes.length; i++) {
				nodes[i].score = maltFuncMetrics.maltMetrics[metric].extractor(nodes[i].stats)/max*100.0;
				nodes[i].scoreReadable = Math.round(nodes[i].score*100)/100 + '%';
			}
		} else {
			for (var i = 0; i < nodes.length; i++) {
				nodes[i].score = maltFuncMetrics.maltMetrics[metric].extractor(nodes[i].stats);
				nodes[i].scoreReadable = maltFuncMetrics.maltMetrics[metric].formalter(nodes[i].score);
			}
		}
	}

	/**
	 * Get edges for the Call-tree
	 * @return {array} Array of edges {from, to}
	 */
	this.getEdges = function() {
		return fulltree.edges;
	}

	/**
	 * Get nodes for the call-tree
	 * @return {array} Array of nodes {id, label, level, score}
	 */
	this.getNodes = function() {
		return fulltree.nodes;
	}

	/**
	 * Get a node by function name
	 * @param  {string} func Function name
	 * @return {object}      Node if found, otherwise null
	 */
	this.getNodeByFunctionName = function(func) 
	{
		var nodes = fulltree.nodes;
		for (var i = 0; i < nodes.length; i++) {
			if(nodes[i].data.location.function == func) {
				return nodes[i];
			}
		}
		return null;
	}

	/**
	 * Get a node by its node id
	 * @param  {int} nodeId Node id to search for
	 * @return {object}        Node
	 */
	this.getNodeById = function(nodeId) {
		return fulltree.nodes[nodeId-1];
	}

	/**
	 * Filter a tree to have only decendants of a particular node.
	 * @param  {int} nodeId  Node id of the focal node
	 * @param  {object} nodeSet Set of nodes already in graph
	 * @param  {array} edges   Set of edges already in graph
	 * @param  {int} depth   Depth to limit the tree to. Defaults to unlimited.
	 * @param  {float} costFilter   Mimimum cost for node to be included.
	 */
	function filterDescendantsRecurse(nodeId, nodeSet, edges, depth, costFilter) {
		nodeSet["" + nodeId] = true;

		var currentEdges = fulltree.nodes[nodeId-1].outEdges;
		for (var i = 0; i < currentEdges.length; i++) {
			if(!(("" + currentEdges[i]) in nodeSet)) {
				if(depth !== 0) {
					if(!costFilter(fulltree.nodes[currentEdges[i]-1].score))
						return;

					nodeSet["" + currentEdges[i]] = true;

					filterDescendantsRecurse(currentEdges[i], nodeSet, edges, depth - 1, costFilter);
				}
			}
			
			if(("" + currentEdges[i]) in nodeSet) {
				edges.push({from: nodeId, to: currentEdges[i] });
			}
		}
	}

	/**
	 * Filter a tree to have only ancestors of a particular node.
	 * @param  {int} nodeId  Node id of the focal node
	 * @param  {object} nodeSet Set of nodes already in graph
	 * @param  {array} edges   Set of edges already in graph
	 * @param  {int} height   height to limit the tree to. Defaults to unlimited.
	 * @param  {float} costFilter   Mimimum cost for node to be included.
	 */
	function filterAncestorsRecurse(nodeId, nodeSet, edges, height, costFilter) {
		nodeSet["" + nodeId] = true;

		var currentEdges = fulltree.nodes[nodeId-1].inEdges;
		for (var i = 0; i < currentEdges.length; i++) {
			if(!(("" + currentEdges[i]) in nodeSet)) {
				if(!costFilter(fulltree.nodes[currentEdges[i]-1].score))
					return;

				if(height !== 0) {
					nodeSet["" + currentEdges[i]] = true;
					filterAncestorsRecurse(currentEdges[i], nodeSet, edges, height - 1, costFilter);
				}

			}

			if(("" + currentEdges[i]) in nodeSet) {
				edges.push({from: currentEdges[i], to: nodeId});
			}
		}
	}

	/**
	 * Filter a tree to have only decendants of a particular node.
	 * @param  {int} nodeId  Node id of the focal node
	 * @param  {int} depth   Depth to limit the tree to. Defaults to unlimited.
	 * @param  {float} costFilter   Mimimum cost for node to be included.
	 * @return {object}                      A tree object containing 'nodes' and 'edges'.
	 */
	function filterDescendants(nodeId, depth, costFilter) {
		var nodeSet = {}, nodeList = [], edgeList = [];
		filterDescendantsRecurse(nodeId, nodeSet, edgeList, depth || -1, costFilter);
		for(var i in nodeSet) {
			nodeList.push(fulltree.nodes[i-1]);
		}
		return {nodes: nodeList, edges: edgeList};
	}

	/**
	 * Filter a tree to have only ancestors of a particular node.
	 * @param  {int} nodeId  Node id of the focal node
	 * @param  {int} height   Height to limit the tree to. Defaults to unlimited.
	 * @param  {float} costFilter   Mimimum cost for node to be included.
	 * @return {object}                      A tree object containing 'nodes' and 'edges'.
	 */
	function filterAncestors (nodeId, height, costFilter) {
		var nodeSet = {}, nodeList = [], edgeList = [];
		filterAncestorsRecurse(nodeId, nodeSet, edgeList, height || -1, costFilter);
		for(var i in nodeSet) {
			nodeList.push(fulltree.nodes[i-1]);
		}
		return {nodes: nodeList, edges: edgeList};
	}

	/**
	 * Filter a tree to have only the ancestors and decendants for a particular node.
	 * @param  {int} nodeId Node id of focal node
	 * @param  {int} depth  Depth to limit to. Defaults to unlimited.
	 * @param  {int} height Height to limit to. Defaults to unlimited. 
	 * @param  {float} costFilterPercentage Minimum cost in percentage for node to be included.
	 * @param  {string} metric               Type of metric to use as score.
	 * @return {object}                      A tree object containing 'nodes' and 'edges'.
	 */
	this.filterNodeLine = function(nodeId, depth, height, costFilterPercentage, metric, isRatio) {
		addScores(fulltree.nodes, metric, isRatio);
		addColorCodes(fulltree);

		var max = -1;
		for (var i = 0; i < fulltree.nodes.length; i++) {
			if(fulltree.nodes[i].score > max) {
				max = fulltree.nodes[i].score;
			}
		}
		var min = max + 1;
		for (var i = 0; i < fulltree.nodes.length; i++) {
			if(fulltree.nodes[i].score < min) {
				min = fulltree.nodes[i].score;
			}
		}

		var childrenCostFilter = new CostFilter(costFilterPercentage, [min, fulltree.nodes[nodeId-1].score, max], metric);
		var parentCostFilter = new CostFilter(costFilterPercentage, [min, max], metric);
		var descs = filterDescendants(nodeId, depth, childrenCostFilter);
		var ancs = filterAncestors(nodeId, height, parentCostFilter);

		var edgeSet = {};
		for (var i = 0; i < descs.edges.length; i++) {
			edgeSet[descs.edges[i].from + ',' + descs.edges[i].to] = descs.edges[i];
		}
		for (var i = 0; i < ancs.edges.length; i++) {
			edgeSet[ancs.edges[i].from + ',' + ancs.edges[i].to] = ancs.edges[i];
		}

		var edgeList = [];
		for(var i in edgeSet) {
			edgeList.push(edgeSet[i]);
		}

		return {nodes: union(descs.nodes, ancs.nodes), edges: edgeList};
	}

	/**
	 * Filter a tree to get all root nodes plus their descendants
	 * @param  {int}    depth                Depth to limit to. Defaults to unlimited.
	 * @param  {int}    costFilterPercentage Minimum cost in percentage for node to be included.
	 * @param  {string} metric               Type of metric to use as score.
	 * @return {object}                      A tree object containing 'nodes' and 'edges'.
	 */
	this.filterRootLines = function(depth, costFilterPercentage, metric, isRatio) {
		addScores(fulltree.nodes, metric, isRatio);
		addColorCodes(fulltree);

		var max = -1;
		for (var i = 0; i < fulltree.nodes.length; i++) {
			if(fulltree.nodes[i].score > max) {
				max = fulltree.nodes[i].score;
			}
		}
		var min = max + 1;
		for (var i = 0; i < fulltree.nodes.length; i++) {
			if(fulltree.nodes[i].score < min) {
				min = fulltree.nodes[i].score;
			}
		}

		var nodeSet = {}, edgeList = [];
		for (var i = 0; i < fulltree.nodes.length; i++) {
			if(fulltree.nodes[i].inEdges.length == 0) {
				var childrenCostFilter = new CostFilter(costFilterPercentage, [min, fulltree.nodes[i].score, max], metric);
				filterDescendantsRecurse(fulltree.nodes[i].id, nodeSet, edgeList, depth, childrenCostFilter);
			}
		}
		
		var edgeSet = {};
		var edges = [];
		var nodes = [];
		for (var i = 0; i < edgeList.length; i++) {
			edgeSet[edgeList[i].from + ',' + edgeList[i].to] = edgeList[i];
		}
		for(var i in edgeSet) {
			edges.push(edgeSet[i]);
		}
		for(var i in nodeSet) {
			nodes.push(fulltree.nodes[i-1]);
		}

		return {nodes: nodes, edges: edges};
	}

	// console.time("buildCallTree");
	var calltree = buildCallTree(stacktree);
	// console.timeEnd("buildCallTree");

	// console.time("generateTreeDataSet");
	var fulltree = generateTreeDataSet(calltree);
	// console.timeEnd("generateTreeDataSet");

	// console.time("addColorCodes");
	// console.timeEnd("addColorCodes");

	return this;
}

module.exports = CallTreeAdapter;