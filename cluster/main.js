
//beefy main.js:bundle.js -- -t [ babelify [--presets es2015 ] ]
//browserify -t [ uglifyify --no-sourcemap ] app.js

require("babel-polyfill");
var clusterfck = require("clusterfck");
var Heap = require('heap');
var THREE = require("three-js")();

//---------GLOBALS-----------

//prep lat and long data
var LATVAL = 'lat';
var LONVAL = 'lng';
var LATPAD = 0;
var LONPAD = 0;
var ROOT_NODES = [];
var ALL_NODES = []; //DEBUG ONLY, COMMENT OUT
var NODEID_TO_NODE = {};
var LEAFROW_TO_NODE = {};
var LEAF_NODES = [];
var LEAF_QUAD_TREE;
var LEAVES_ONSCREEN = [];
var CLUSTERS_ONSCREEN = [];
var LEAFROW_TO_CURRENT_CLUSTER = {};
var PADDING = 0;
var DATASET = null;

var FORCE_MODEL = null;

var PALETTE_INDEX = 0;
var POPOVER_PALETTE = ["#ae451c","#594c3a","#2d8683","#4f437b","#af8200","#3c5589","#537d4f"];

/*
var svg = d3.select("#graph"),
    margin = {top: 40, right: 40, bottom: 40, left: 40},
    width = +svg.attr("width") - margin.left - margin.right,
    height = +svg.attr("height") - margin.top - margin.bottom,
    selected,
    g = svg.append("g")
    .attr("transform", "translate(" + margin.left + "," + margin.top + ")");
    */
//var treesvg = d3.select("#tree").append("g").attr("transform", "translate(350,200)");
var OVERLAY;

d3.json('data_restaurants_pittsburghpa__2017-04-27_06-40.json',ready);





//--------GLOBAL END---------




var vecFrom = function (p0, p1) {               // Vector from p0 to p1
    return [ p1[0] - p0[0], p1[1] - p0[1] ];
};

var vecScale = function (v, scale) {            // Vector v scaled by 'scale'
    return [ scale * v[0], scale * v[1] ];
};

var vecSum = function (pv1, pv2) {              // The sum of two points/vectors
    return [ pv1[0] + pv2[0], pv1[1] + pv2[1] ];
};

var vecUnit = function (v) {                    // Vector with direction of v and length 1
    var norm = Math.sqrt (v[0]*v[0] + v[1]*v[1]);
    return vecScale (v, 1/norm);
};

var vecScaleTo = function (v, length) {         // Vector with direction of v with specified length
    return vecScale (vecUnit(v), length);
};

var unitNormal = function (pv0, p1) {           // Unit normal to vector pv0, or line segment from p0 to p1
    if (p1 != null) pv0 = vecFrom (pv0, p1);
    var normalVec = [ -pv0[1], pv0[0] ];
    return vecUnit (normalVec);
};


var lineFn = d3.line()
               .curve (d3.curveCatmullRomClosed)
                .x (function(d) { return d.p[0]; })
                .y (function(d) { return d.p[1]; });






class Node{

    constructor(id, data_src, data_rows, parentNode, children, depth) {
        this.id = id;
        this.data_src = data_src;
        this.data_rows = data_rows;
        this.parentNode = parentNode;
        this.children = children;
        this.depth = depth;
        this.nearby_rows = [];
        this.vals = new Object(); //lazy load for dataValues
        this.highlighted = false;
        this.groupMember = false;
        this.isOnScreen = true; //assume should be drawn unless marked otherwise
        this.isOnScreenPadded = true; //assume should be drawn unless marked otherwise

        this.rank = -1;

        this.radius = Node.circleSize(this);
        this.hullPadding = 6;
        this.hull = null;
        this.hullBoundingBox = null;
        this.hullArea = null;
        this.hullCentroid = null;
        this.lastComputedPath = null; //most recent output from PathDProjection call
        this.lastPathCentroid = [null, null]; //centroid for last time PathDProjection called
        this.ancestorAnimationPath = null; //used for animating breaking/combining

    }

    dataValue(column) {
        if (column in this.vals) {
            return this.vals[column];
        }

        let x_avg = 0;
        let i = 0;

        for (let row of this.data_rows) {

            let val = this.data_src[row][column];
            if (! isNaN(val)) {
                x_avg += val;
                i++;
            }


        }

        if (isNaN(x_avg / i)) {
            console.log(x_avg);
        }

        this.vals[column] = x_avg / i;
        return this.vals[column];

    }

    //Draw the chart points
    static circleSize(d) {

        if (d.data_rows.length < 1) {
            return 2;
        }
        else if (d.data_rows.length < 5) {
            return 5;
        }
        else if (d.data_rows.length < 20) {
            return 10;
        }
        else if (d.data_rows.length < 60) {
            return 18;
        }
        else if (d.data_rows.length < 120) {
            return 28;
        }
        else if (d.data_rows.length < 300) {
            return 50;
        }
        else {
            return 90;
        }
    }


    vecScale(scale, v) {
        // Returns the vector 'v' scaled by 'scale'.
        return [ scale * v[0], scale * v[1] ];
    }


    vecSum(pv1, pv2) {
        // Returns the sum of two vectors, or a combination of a point and a vector.
        return [ pv1[0] + pv2[0], pv1[1] + pv2[1] ];
    }


    unitNormal(p0, p1) {
        // Returns the unit normal to the line segment from p0 to p1.
        var n = [ p0[1] - p1[1], p1[0] - p0[0] ];
        var nLength = Math.sqrt (n[0]*n[0] + n[1]*n[1]);
        return [ n[0] / nLength, n[1] / nLength ];
    }

    getCircleD(pX, pY) {
            //circle
            let p1 = [pX, pY - this.hullPadding];
            let p2 = [pX, pY + this.hullPadding];

            return 'M ' + p1
                + ' A ' + [this.hullPadding, this.hullPadding, '0,0,0', p2].join(',')
                + ' A ' + [this.hullPadding, this.hullPadding, '0,0,0', p1].join(',');
    }
    getCapsuleD(poly0, poly1) {

            //occasionally get a case where the two points are identical
            if (poly0[0] === poly1[0] && poly0[1] === poly1[1]) {
                return this.getCircleD(poly0[0], poly0[1]);
            }

            let offsetVector = this.vecScale(this.hullPadding, this.unitNormal(poly0, poly1));
            let invOffsetVector = this.vecScale(-1, offsetVector);

            let p0 = this.vecSum(poly0, offsetVector);
            let p1 = this.vecSum(poly1, offsetVector);
            let p2 = this.vecSum(poly1, invOffsetVector);
            let p3 = this.vecSum(poly0, invOffsetVector);

            return 'M ' + p0
                + ' L ' + p1 + ' A ' + [this.hullPadding, this.hullPadding, '0,0,0', p2].join(',')
                + ' L ' + p3 + ' A ' + [this.hullPadding, this.hullPadding, '0,0,0', p0].join(',');

    }

    getHullBoundingBox(latVar, lonVar) {
        if (this.data_rows.length === 0) {
            //no center
            return null;
        }
        else if (this.data_rows.length === 1) {
            //center of 1 point
            let lat = this.data_src[this.data_rows[0]][latVar];
            let lon = this.data_src[this.data_rows[0]][lonVar];
            return [lat, lon, lat, lon];
        }
        else {

            if (this.hullBoundingBox) {
                return this.hullBoundingBox;
            }

            //center of convex hull of points (should be same as BBox center)
            let points;
            if (this.hull) {  //only do once since inefficient
                points = this.hull;
            }
            else {
                let datapoints = [];
                for (let index=0; index<this.data_rows.length; index++) {
                    datapoints.push([this.data_src[this.data_rows[index]][latVar], this.data_src[this.data_rows[index]][lonVar]]);
                }

                points = (datapoints.length < 3) ? datapoints : d3.polygonHull(datapoints);
                this.hull = points;
            }

            let latMin = 999;
            let lonMin = 999;
            let latMax = -999;
            let lonMax = -999;
            for (let index=0; index<points.length; index++) {
                latMin = Math.min(latMin, points[index][0]);
                latMax = Math.max(latMax, points[index][0]);
                lonMin = Math.min(lonMin, points[index][1]);
                lonMax = Math.max(lonMax, points[index][1]);
            }

            this.hullBoundingBox = [latMin, lonMin, latMax, lonMax];

            return this.hullBoundingBox;

        }
    }

    getHullArea(latVar, lonVar) {

        if (this.data_rows.length === 0) {
            //no center
            return 0;
        }
        else if (this.data_rows.length === 1) {
            //center of 1 point
            return 0;
        }
        else if (this.data_rows.length === 2) {
            return 0;
        }
        else {
            if (this.hullArea) {
                return this.hullArea;
            }

            //center of convex hull of points (should be same as BBox center)
            let points;
            if (this.hull) {  //only do once since inefficient
                points = this.hull;
            }
            else {
                let datapoints = [];
                for (let index=0; index<this.data_rows.length; index++) {
                    datapoints.push([this.data_src[this.data_rows[index]][latVar], this.data_src[this.data_rows[index]][lonVar]]);
                }

                points = (datapoints.length < 3) ? datapoints : d3.polygonHull(datapoints);
                this.hull = points;
            }

            this.hullArea = d3.polygonArea(this.hull);

            this.sparseness = this.hullArea / this.data_rows.length;

            return this.hullArea;

        }

    }

    checkContainment(latVar, lonVar, latlng) {
        if (this.data_rows.length < 3) {
            return false;
        }
        else {

            //center of convex hull of points (should be same as BBox center)
            let points;
            if (this.hull) {  //only do once since inefficient
                points = this.hull;
            }
            else {
                let datapoints = [];
                for (let index=0; index<this.data_rows.length; index++) {
                    datapoints.push([this.data_src[this.data_rows[index]][latVar], this.data_src[this.data_rows[index]][lonVar]]);
                }

                points = (datapoints.length < 3) ? datapoints : d3.polygonHull(datapoints);
                this.hull = points;
            }

            /*
            let cx = 0.0;
            let cy = 0.0;
            for (let index=0; index<points.length; index++) {
                let latLng = new google.maps.LatLng(points[index][0],points[index][1]);
                let proj = projection.fromLatLngToContainerPixel(latLng)
                cx += proj.x;
                cy += proj.y;
            }

            return [cx / points.length, cy / points.length];
            */

            return d3.polygonContains(this.hull, latlng);

        }

    }


    getHullCentroid(latVar, lonVar) {

        if (this.data_rows.length === 0) {
            //no center
            console.log("WARNING, POLLING NODE WITH NO DATA ROWS");
            return [null, null];
        }
        else if (this.data_rows.length === 1) {
            //center of 1 point
            return [this.data_src[this.data_rows[0]][latVar], this.data_src[this.data_rows[0]][lonVar]];
        }
        else if (this.data_rows.length === 2) {
            return [(this.data_src[this.data_rows[0]][latVar]+this.data_src[this.data_rows[1]]           [latVar]) / 2.0,
                    (this.data_src[this.data_rows[0]][lonVar]+this.data_src[this.data_rows[1]][lonVar]) / 2.0];
        }
        else {
            if (this.hullCentroid) {
                return this.hullCentroid;
            }

            //center of convex hull of points (should be same as BBox center)
            let points;
            if (this.hull) {  //only do once since inefficient
                points = this.hull;
            }
            else {
                let datapoints = [];
                for (let index=0; index<this.data_rows.length; index++) {
                    datapoints.push([this.data_src[this.data_rows[index]][latVar], this.data_src[this.data_rows[index]][lonVar]]);
                }

                points = (datapoints.length < 3) ? datapoints : d3.polygonHull(datapoints);
                this.hull = points;
            }

            /*
            let cx = 0.0;
            let cy = 0.0;
            for (let index=0; index<points.length; index++) {
                let latLng = new google.maps.LatLng(points[index][0],points[index][1]);
                let proj = projection.fromLatLngToContainerPixel(latLng)
                cx += proj.x;
                cy += proj.y;
            }

            return [cx / points.length, cy / points.length];
            */

            this.hullCentroid = d3.polygonCentroid(this.hull);

            return this.hullCentroid;

        }

    }


    getCenterDProj(latVar, lonVar, projection) {

        let centroid = this.getHullCentroid(latVar, lonVar);
        let latLng = new google.maps.LatLng(centroid[0],centroid[1]);
        let proj = projection.fromLatLngToContainerPixel(latLng);

        return [proj.x, proj.y];
    }

    getPathDProj(latVar, lonVar, projection) {

        if (this.data_rows.length === 0) {
            return '';
        }

        //get the convex hull in data space points
        let points;
        if (this.hull) {  //only do once since inefficient
            points = this.hull;
        }
        else {
            let datapoints = [];
            for (let index=0; index<this.data_rows.length; index++) {
                datapoints.push([this.data_src[this.data_rows[index]][latVar], this.data_src[this.data_rows[index]][lonVar]]);
            }

            points = (datapoints.length < 3) ? datapoints : d3.polygonHull(datapoints);
            this.hull = points;
        }


        //transform the points to screen space coords
        // AND translate them from center to 0,0 (will later use transforms to position properly)
        let modpoints = [];
        for (let index=0; index<points.length; index++) {

            let latLng = new google.maps.LatLng(points[index][0],
                                                points[index][1]);

            let proj = projection.fromLatLngToContainerPixel(latLng);

            modpoints.push([proj.x, proj.y]);

        }

        let d = this.getPathD(modpoints);
        this.lastComputedPath = d;
        this.lastPathCentroid = this.getCenterDProj(latVar, lonVar, projection);
        return d;

    }

    getExpandedPathDProj(latVar, lonVar, projection, expandBy) {
        if (this.data_rows.length === 0) {
            return '';
        }

        //get the convex hull in data space points
        let points;
        if (this.hull) {  //only do once since inefficient
            points = this.hull;
        }
        else {
            let datapoints = [];
            for (let index=0; index<this.data_rows.length; index++) {
                datapoints.push([this.data_src[this.data_rows[index]][latVar], this.data_src[this.data_rows[index]][lonVar]]);
            }

            points = (datapoints.length < 3) ? datapoints : d3.polygonHull(datapoints);
            this.hull = points;
        }


        //transform the points to screen space coords
        // AND translate them from center to 0,0 (will later use transforms to position properly)
        let modpoints = [];
        for (let index=0; index<points.length; index++) {

            let latLng = new google.maps.LatLng(points[index][0],
                                                points[index][1]);

            let proj = projection.fromLatLngToContainerPixel(latLng);

            modpoints.push([proj.x, proj.y]);

        }

        let d = this.getExpandedPathD(modpoints, expandBy);

        return d;


    }



    /* //DEPRECATED
    getPathDScale(xVar, xScale, yVar, yScale) {

        if (this.data_rows.length === 0) {
            return '';
        }

        //get the convex hull in data space points
        let points;
        if (this.hull) {  //only do once since inefficient
            points = this.hull;
        }
        else {
            let datapoints = [];
            for (let index=0; index<this.data_rows.length; index++) {
                datapoints.push([this.data_src[this.data_rows[index]][xVar], this.data_src[this.data_rows[index]][yVar]]);
            }

            points = (datapoints.length < 3) ? datapoints : d3.polygonHull(datapoints)
            this.hull = points;
        }

        //transform the points to screen space coords
        let modpoints = [];
        for (let index=0; index<points.length; index++) {

            modpoints.push([xScale(points[index][0]), yScale(points[index][1])]);

        }

        return this.getPathD(modpoints);
    }*/




    // Hull Generators



    getPathD(points) {

        if (points.length < 2) {

            return this.getCircleD(points[0][0], points[0][1]);

        }
        else if (points.length === 2) {

            return this.getCapsuleD(points[0], points[1]);

        }
        else {


            var pointCount = points.length;

            var hullPoints = points.map (function (point, index) {
                var pNext = points [(index + 1) % pointCount];
                return {
                    p: point,
                    v: vecUnit (vecFrom (point, pNext))
                };
            });

            // Compute the expanded hull points, and the nearest prior control point for each.
            for (var i = 0;  i < hullPoints.length;  ++i) {
                var priorIndex = (i > 0) ? (i-1) : (pointCount - 1);
                var extensionVec = vecUnit (vecSum (hullPoints[priorIndex].v, vecScale (hullPoints[i].v, -1)));
                hullPoints[i].p = vecSum (hullPoints[i].p, vecScale (extensionVec, this.hullPadding));
            }

            let ret = lineFn (hullPoints);
            this.lastComputedPath = ret;
            return ret;

            /*
            old polygon approach
            //polygon
            let segments = new Array (points.length);

            // Calculate each offset (outwards) segment of the convex hull.
            for (let segmentIndex = 0;  segmentIndex < segments.length;  ++segmentIndex) {
                var p0 = (segmentIndex === 0) ? points[points.length-1] : points[segmentIndex-1];
                var p1 = points[segmentIndex];

                // Compute the offset vector for the line segment, with length = hullPadding.
                let offset = this.vecScale(this.hullPadding, this.unitNormal(p0, p1));

                segments[segmentIndex] = [ this.vecSum(p0, offset), this.vecSum(p1, offset) ];
            }

            let arcData = 'A ' + [this.hullPadding, this.hullPadding, '0,0,0,'].join(',');

            //for (let index=0; index<segments.length; index++) {
                //let segment = segments[i];
            segments = segments.map (function (segment, index) {
                var pathFragment = "";
                if (index === 0) {
                    var pathFragment = 'M ' + segments[segments.length-1][1] + ' ';
                }
                pathFragment += arcData + segment[0] + ' L ' + segment[1];

                return pathFragment;
            });

            //console.log(segments.join(' '));

            let ret = segments.join(' ');
            this.lastComputedPath = ret;

            return ret;*/
        }

    }


    getExpandedPathD(points, expandBy) {



        if (points.length < 3) {
            return "";
        }


        var pointCount = points.length;

        var hullPoints = points.map (function (point, index) {
            var pNext = points [(index + 1) % pointCount];
            return {
                p: point,
                v: vecUnit (vecFrom (point, pNext))
            };
        });

        // Compute the expanded hull points, and the nearest prior control point for each.
        for (var i = 0;  i < hullPoints.length;  ++i) {
            var priorIndex = (i > 0) ? (i-1) : (pointCount - 1);
            var extensionVec = vecUnit (vecSum (hullPoints[priorIndex].v, vecScale (hullPoints[i].v, -1)));
            hullPoints[i].p = vecSum (hullPoints[i].p, vecScale (extensionVec, this.hullPadding + expandBy));
        }

        let ret = lineFn (hullPoints);
        this.lastComputedPath = ret;

        return ret;



    }


    renderNode(view_style) {
        return false;
    }

}




function getScaleForDatatype(data, column, size) {

    let allDate = true;
    let allNumber = true;
    let allInt = true;
    let allBool = true;
    for (let i=0; i<data.length; i++) {
        let x = data[i][column];
        if (x.length < 1) {
            continue;
        }

        allDate = allDate && !isNaN(Date.parse(x));
        allNumber = allNumber && !isNaN(+x) && !(toString.call(x) === '[object Date]');
        allInt = allInt && !isNaN(+x) && (x=+x) === ~~x && !(toString.call(x) === '[object Date]');
        allBool = allBool && (x==='true' || x==='false' || x === true || x === false || toString.call(x) == '[object Boolean]' );

    }

    var scale;
    if (allBool) {
        let temp = [];
        for (let i=0; i<data.length; i++) {
            data[i][column] = +data[i][column];
            temp.push(+data[i][column]);
        }
        scale = d3.scaleLinear()
                  .range([0+PADDING, size - (2*PADDING)])
                  .domain(d3.extent(temp))
                  .nice();
    }
    else if (allInt) {
        let temp = [];
        for (let i=0; i<data.length; i++) {
            data[i][column] = +data[i][column];
            temp.push(+data[i][column]);
        }
        scale = d3.scaleLinear()
                  .range([0+PADDING, size - (2*PADDING)])
                  .domain(d3.extent(temp))
                  .nice();
    }
    else if (allNumber) {
        let temp = [];
        for (let i=0; i<data.length; i++) {
            data[i][column] = +data[i][column];
            temp.push(+data[i][column]);
        }
        scale = d3.scaleLinear()
                  .range([0+PADDING, size - (2*PADDING)])
                  .domain(d3.extent(temp))
                  .nice();
    }
    else if (allDate) {
        let temp = [];
        for (let i=0; i<data.length; i++) {
            data[i][column] = Date.parse(data[i][column]);
            temp.push(data[i][column]);
        }
        scale = d3.scaleLinear()
                  .range([0+PADDING, size - (2*PADDING)])
                  .domain(d3.extent(temp))
                  .nice();
    }
    else {
        let temp = [];
        for (let i=0; i<data.length; i++) {
            temp.push(data[i][column]);
        }
        scale = d3.scalePoint()
                  .range([0+PADDING, size - (2*PADDING)])
                  .domain(temp);

    }

    return scale;

}

//  --------------------- HEURISTICS -----------------------


var MAX_ONSCREEN = 20;
var CLUSTER_SKIP_SIZE = 4; //clusters of this size or lower aren't broken up further, but may combine with other clusters during the merge phase if they are too small onscreen
var CLUSTER_AREA_THRESHOLD = 0.05; //percent of screen taken up before breaking apart
var CLUSTER_AREA_OFFSCREEN_THRESHOLD = 0.05; //percent of screen taken up offscreen before combine
var CLUSTER_SPARSENESS_THRESHOLD = 0.0015;

var RECENTLY_EXPANDED = {}; //recently expanded node marking to prevent thrashing of break/combine
//this should be updated whenever zoom triggers

var PREVIOUS_VIEWSIZE = -1;



function clearExpansion() {
    //console.log("clear expansion");
    RECENTLY_EXPANDED = {};
}

function adjustClusters(startingNodes, viewSize, isInBounds, isInBoundsPadded) {
    //list of nodes to break/combine, float of viewport area, function true if point in viewport



    //-------------------------COMBINE
    //now start combining nodes back together, but ignore any stuff that is onscreen and recently broken apart



    let priorityQueue = new Heap(function(a,b) {
        return b.depth - a.depth;   //put the stuff at the _bottom_ of the tree first
    });
    let processedNodes = [];
    let childrenToRemove = {};

    //climbs up parent links to see if anything in the chain has a deletion mark
    //need to do this because of edge case where we need to garbage collect ALL descendents, not just immediate children. in some cases there are intermediate nodes
    function markedDeleted(n) {
        if (n.id in childrenToRemove) {
            return true;
        }

        while (n.parentNode) {  //root nodes have null parentNode
            n = n.parentNode;
            if (n.id in childrenToRemove) {
                return true;
            }

        }

        return false;
    }
    /*
    function markedExpanded(n) {
        if (n.id in RECENTLY_EXPANDED) {
            return true;
        }

        while (n.parentNode) {
            n = n.parentNode;
            if (n.id in RECENTLY_EXPANDED) {
                return true;
            }

        }

        return false;
    }*/


    //-------------------------ONSCREEN COMBINE
    //route them by area
    let i=startingNodes.length-1;
    while (i>=0) {
        let node = startingNodes[i];

        //for anything that has a recently expanded node above it, it is complete

        //skip processing any nodes that have been marked recently expanded
        if (node.id in RECENTLY_EXPANDED) { //don't think we need to use markedExpanded()
            processedNodes.push(node);
        }
        else {

            let area = node.getHullArea(LATVAL, LONVAL);
            let percentage = (area === 0 ? 0 : area*100 / viewSize);
            let sparseness = percentage / node.data_rows.length;

            //if the node data size is below our threshold, check how other siblings compare
            if (node.depth != 1 && node.data_rows.length <= CLUSTER_SKIP_SIZE) {

                let allMin = true;
                let avg = 0;
                let count = 0;
                let y=node.parentNode.children.length-1;
                while (y>=0) {
                    let child = node.parentNode.children[y];
                    if (child.id != node.id) {

                        if (child.data_rows.length > CLUSTER_SKIP_SIZE) {
                            allMin = false;
                            let cArea = child.getHullArea(LATVAL, LONVAL);
                            let cPercentage = (cArea === 0 ? 0 : cArea*100 / viewSize);
                            avg = avg + cPercentage;
                            count++;
                        }

                    }
                    y--;
                }
                if (!allMin) {
                    percentage = avg / count;
                }


            }


            let centroid = node.getHullCentroid(LATVAL, LONVAL);
            let inBounds = isInBoundsPadded(centroid[0],centroid[1]);
            if (inBounds &&
                (percentage < CLUSTER_AREA_THRESHOLD &&
                 sparseness < CLUSTER_SPARSENESS_THRESHOLD)) { //onscreen
                priorityQueue.push(node);
            }
            else if (!inBounds && percentage < CLUSTER_AREA_OFFSCREEN_THRESHOLD) { //offscreen
                priorityQueue.push(node);
            }
            else {
                processedNodes.push(node);
            }
        }

        i--;
    }


    //start combining them
    while (priorityQueue.size() > 0) {

        let node = priorityQueue.pop();

        //if we've already removed this node, skip it
        if (markedDeleted(node)) {
            continue;
        }

        //console.log("size: "+priorityQueue.size()+" id: "+node.id+" depth: "+node.depth);

        //if this node is already at the top of the tree, we can't do much
        if (node.depth === 1) {
            processedNodes.push(node);

            continue;
        }


        //grab the parent and check to make sure we're traversing correctly
        let parent = node.parentNode;
        /*if (markedDeleted(parent)) {
            console.log("WARNING - PARENT DETECTED IN REMOVED CHILDREN LIST"); //SANITY CHECK
        }
        if (parent.id in RECENTLY_EXPANDED) {
            console.log("WARNING - PARENT IN RECENTLY EXPANDED LIST");
        }*/

        //mark the children as deleted
        let k=parent.children.length-1;
        while (k>=0) {

            let child = parent.children[k];

            childrenToRemove[child.id] = 1;

            //propagate the animation path down the children
            parent.ancestorAnimationPath = child.lastComputedPath;

            k--;

        }

        //add the parent back into the stack
        let area = parent.getHullArea(LATVAL, LONVAL);
        let percentage = (area === 0 ? 0 : area*100 / viewSize);
        let sparseness = percentage / node.data_rows.length;
        let centroid = node.getHullCentroid(LATVAL, LONVAL);
        let inBounds = isInBoundsPadded(centroid[0],centroid[1]);

        if (inBounds &&
            (percentage < CLUSTER_AREA_THRESHOLD &&
                 sparseness < CLUSTER_SPARSENESS_THRESHOLD)) {
            priorityQueue.push(parent);
            //console.log('requeue: '+parent.id+" perc: "+percentage);
            //console.log("COMBINE "+node.id+" sz"+percentage);
        }
        else if (!inBounds && percentage < CLUSTER_AREA_OFFSCREEN_THRESHOLD) {
            priorityQueue.push(parent);
            //console.log('requeue: '+parent.id+" perc: "+percentage);
            //console.log("COMBINE_OFFSCREEN "+node.id+" sz"+percentage);
        }
        else {
            processedNodes.push(parent);
            //console.log('done '+parent.id);

            //propagate animation to parent's children
        }

    }


    processedNodes = processedNodes.filter(function(d) {return !(markedDeleted(d));});

    //console.log("cycle-check after combine onscreen");
    //checkForCycles();  //DEBUG



    //-------------------------BREAKUP
    //expand onscreen nodes if they are too big
    priorityQueue = new Heap(function(a,b) {
        return -(b.depth - a.depth);   //put the stuff at the top of the tree first
    });
    let finalNodes = [];



    //route them by area
    i=processedNodes.length-1;
    while (i>=0) {
        let node = processedNodes[i];
        let centroid = node.getHullCentroid(LATVAL, LONVAL);

        if (node.data_rows.length <= CLUSTER_SKIP_SIZE) {
            //node.isOnScreen = isInBounds(centroid[0],centroid[1]);
            //node.isOnScreenPadded = isInBoundsPadded(centroid[0],centroid[1]);
            finalNodes.push(node);
        }
        else if (isInBoundsPadded(centroid[0],centroid[1])) {

            let area = node.getHullArea(LATVAL, LONVAL);
            let percentage = (area === 0 ? 0 : area*100 / viewSize);
            let sparseness = percentage / node.data_rows.length;

            if (percentage >= CLUSTER_AREA_THRESHOLD ||
                sparseness > CLUSTER_SPARSENESS_THRESHOLD) {
                priorityQueue.push(node);
                //console.log("BREAK "+node.id+" sz"+percentage);
            }
            else {
                finalNodes.push(node);
            }
        }
        else {
            //node.isOnScreen = false;
            finalNodes.push(node);
        }

        i--;
    }


    //DEBUG
    /*
    function checkForCycles() {
        let cc = {};
        let test = onscreenNodes.concat(offscreenNodes);
        for (let k=0;k<test.length;k++) {
            for (let j=0;j<test[k].children.length;j++) {
                if (test[k].children[j].id in cc) {
                    console.log("WARNING - PARENTS WITH SHARED CHILDREN FOUND");
                }
                else {
                    cc[test[k].children[j].id] = test[k].id;
                }
            }
        }
        for (let k=0;k<test.length;k++) {
            if (test[k].id in cc) {
                console.log("WARNING - CHILD NODE AS WELL AS PARENT c"+test[k].id+' p'+cc[test[k].id]);
            }
        }
    }*/
    //console.log("cycle-check start");
    //checkForCycles();  //DEBUG


    //SANITY CHECK
    //if (onscreenNodes.length != priorityQueue.size() + finalNodes.length) {
    //    console.log("SIZE MISMATCH!") //sanity check
    //}


    //iterate from the top of the tree down until we've broken down all nodes we can
    while (priorityQueue.size() > 0) {

        let node = priorityQueue.pop();

        //break apart the node
        let k=node.children.length-1;
        while (k>=0) {

            let child = node.children[k];

            /*
            //SANITY CHECK
            if (child.id in RECENTLY_EXPANDED) {
                console.log("BROKE APART NODE WITH CHILDREN ALREADY EXPANDED");
            }            */



            let area = child.getHullArea(LATVAL, LONVAL);
            let percentage = (area === 0 ? 0 : area*100 / viewSize);
            let sparseness = percentage / node.data_rows.length;

            if (percentage >= CLUSTER_AREA_THRESHOLD ||
                sparseness > CLUSTER_SPARSENESS_THRESHOLD) {
                //if still too big, then break it up again
                priorityQueue.push(child);
                //we don't want to mark this as recently expanded yet since may break again

            }
            else {
                //if it's small enough, mark it onscreen
                finalNodes.push(child);
                child.ancestorAnimationPath = parent.lastComputedPath;

                let centroid = node.getHullCentroid(LATVAL, LONVAL);
                child.isOnScreen = isInBounds(centroid[0],centroid[1]);
                child.isOnScreenPadded = isInBoundsPadded(centroid[0],centroid[1]);
                RECENTLY_EXPANDED[child.id] = 1;

            }


            k--;

        }

    }

    //console.log("cycle-check after breakup");
    //checkForCycles(); //SANITY CHECK


    //console.log(finalNodes);




    //post-process breakdown
    i=finalNodes.length-1;
    let breakQueue = [];
    let doneQueue = [];
    while (i>=0) {
        let node = finalNodes[i];
        if (node.data_rows.length <= CLUSTER_SKIP_SIZE) {
            breakQueue.push(node);
        }
        else {
            doneQueue.push(node);
        }
        i--;
    }
    while (breakQueue.length > 0) {
        let node = breakQueue.pop();
        if (node.data_rows.length === 1) {
            doneQueue.push(node);
        }
        else {
            let k = node.children.length-1;
            while (k>=0) {
                breakQueue.push(node.children[k]);
                k--;
            }
        }
    }

    //console.log(doneQueue)
    //console.log("ADJUSTED")

    //record membership for all leaf_nodes
    LEAFROW_TO_CURRENT_CLUSTER = {};
    let x = doneQueue.length-1;
    while (x>=0) {
        let y = doneQueue[x].data_rows.length-1;
        while (y>=0) {
            LEAFROW_TO_CURRENT_CLUSTER[doneQueue[x].data_rows[y]] = doneQueue[x];
            y--;
        }
        x--;
    }


    return doneQueue;

}



class QuantizationBin {

    constructor(id,bin_x,bin_y,x,y,size) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.bin_x = bin_x;
        this.bin_y = bin_y;
        this.size = size;
        this.data_rows = [];
    }

    addRow(r) {
        this.data_rows.push(r);
    }

}



// --------------------- END HEURISTICS --------------------







// -------------- BEGIN DATA FEATURE EXTRACTION ------------


var VALID_NUM_COLUMNS = ['rating',
                         'price_numeric',
                         'num_reviews',
                         'log_num_reviews',
                         'ranking',
                         'images',
                         'highlights'];
var NUM_COLUMN_GETTERS = [function(d) {return parseFloat(d['rating']);},
                        function(d) {return parseFloat(d['price_numeric']);},
                        function(d) {return parseFloat(d['num_reviews']);},
                        function(d) {return Math.log(parseFloat(d['num_reviews']));},
                        function(d) {return parseFloat(d['ranking']);},
                        function(d) {return d['images'].length;},
                        function(d) {return d['highlights'].length;}];
var VALID_NOM_COLUMNS = ['categories',
                         'neighborhood'];

var DESC_STATS = {};
var NEARBY_STATS = {};
var CLUSTER_STATS = {};
var RAW_SCORES = {};


function gatherStats(leaf_nodes) {

    let scratch = leaf_nodes.slice();

    for (let k=0; k<VALID_NUM_COLUMNS.length; k++) {
        let col = VALID_NUM_COLUMNS[k];
        let getter = NUM_COLUMN_GETTERS[k];

        scratch.sort(function (a,b) {
            let aRating = getter(a.data_src[a.data_rows[0]]);
            let bRating = getter(b.data_src[b.data_rows[0]]);
            return bRating-aRating;
        });
        let sum=0;
        let i=scratch.length-1;
        while (i>=0) {
            sum = sum + getter(scratch[i].data_src[scratch[i].data_rows[0]]);
            i--;
        }
        let mean = sum / scratch.length;
        sum = 0;
        i=scratch.length-1;
        while (i>=0) {
            sum = sum + Math.pow(getter(scratch[i].data_src[scratch[i].data_rows[0]]) - mean,2);
            i--;
        }
        let sd = Math.sqrt(sum / scratch.length);

        DESC_STATS[col] = {mean: mean,
                           max: getter(scratch[0].data_src[scratch[0].data_rows[0]]),
                           min: getter(scratch[0].data_src[scratch[scratch.length-1].data_rows[0]]),
                           median: getter(scratch[0].data_src[scratch[Math.floor(scratch.length/2.0)].data_rows[0]]),
                           sd: sd };
        DESC_STATS[col].scale = d3.scaleLinear().domain([DESC_STATS[col].min, DESC_STATS[col].max]).range([0, 1]);


    }

    let pop_cutoff = 0.3;
    let rating_cutoff = 3.9;

    for (let y=0; y<VALID_NOM_COLUMNS.length; y++) {
        let col = VALID_NOM_COLUMNS[y];

        let raw_counts = {};
        let popular_counts = {};
        let best_counts = {};
        let ranked_by_genre = {};

        let i=scratch.length-1;
        while (i>=0) {
            let node = scratch[i];
            let k = node.data_src[node.data_rows[0]][col].length-1;
            let dat = node.data_src[node.data_rows[0]][col];
            if (dat.constructor !== Array) {
                k=0;
                dat = [ node.data_src[node.data_rows[0]][col] ];
            }

            while (k>=0) {
                let v = dat[k];
                let popular = DESC_STATS['num_reviews'].scale(parseFloat(node.data_src[node.data_rows[0]]['num_reviews']));
                let rating = parseFloat(node.data_src[node.data_rows[0]]['rating']);

                if (!(v in raw_counts)) {
                    raw_counts[v] = 0;
                    popular_counts[v] = 0;
                    best_counts[v] = 0;
                    ranked_by_genre[v] = [];
                }

                raw_counts[v] = raw_counts[v] + 1;
                ranked_by_genre[v].push(node.data_rows[0]);
                if (popular >= pop_cutoff) {
                    popular_counts[v] = popular_counts[v] + 1;
                }
                if (rating >= rating_cutoff) {
                    best_counts[v] = best_counts[v] + 1;
                }

                k--;
            }

            i--;
        }
        for (let col in ranked_by_genre) {
            ranked_by_genre[col].sort(function(a,b) {
                return parseFloat(scratch[0].data_src[a]['ranking']) -
                       parseFloat(scratch[0].data_src[b]['ranking']);
            });
        }

        DESC_STATS[col] = {
            count: raw_counts,
            popular: popular_counts,
            high_rated: best_counts,
            ranked: ranked_by_genre
        };
    }


    NEARBY_STATS = {};

    for (let y=0; y<VALID_NOM_COLUMNS.length; y++) {
        let col = VALID_NOM_COLUMNS[y];

        let raw_counts = {};
        let max_counts = {};

        let i=scratch.length-1;
        while (i>=0) {
            let node = scratch[i];

            let near_cats = {};

            let x=node.nearby_rows.length-1;
            while (x>=0) {
                let near = node.nearby_rows[x];
                let k = node.data_src[near][col].length-1;
                let dat = node.data_src[near][col];
                if (dat.constructor !== Array) {
                    k=0;
                    dat = [ node.data_src[near][col] ];
                }

                while (k>=0) {
                    let v = dat[k];

                    if (!(v in near_cats)) {
                        near_cats[v] = 0;
                    }

                    near_cats[v] = near_cats[v] + 1;

                    k--;
                }

                x--;
            }

            for (let v in near_cats) {
                if (!(v in max_counts)) {
                    max_counts[v] = 0;
                }
                max_counts[v] = Math.max(max_counts[v], near_cats[v]);
            }

            raw_counts[node.data_rows[0]] = near_cats;

            i--;
        }

        for (let v in max_counts) {
            max_counts[v] = d3.scaleLinear().domain([0, max_counts[v]]).range([0, 1]);

        }


        NEARBY_STATS[col] = {counts: raw_counts,
                             scales: max_counts };

    }

    //console.log(NEARBY_STATS);


    //console.log(DESC_STATS);
    return DESC_STATS;
}

function clusterStats(n) {

    if (n.id in CLUSTER_STATS) {
        return CLUSTER_STATS[n.id];
    }

    let stats = {};

    let rows = n.data_rows.slice();

    for (let k=0; k<VALID_NUM_COLUMNS.length; k++) {
        let col = VALID_NUM_COLUMNS[k];
        let getter = NUM_COLUMN_GETTERS[k];

        rows.sort(function (a,b) {
            let aRating = getter(n.data_src[a]);
            let bRating = getter(n.data_src[b]);
            return bRating-aRating;
        });
        let sum=0;
        let i=rows.length-1;
        while (i>=0) {
            sum = sum + getter(n.data_src[rows[i]]);
            i--;
        }
        let mean = sum / rows.length;
        sum = 0;
        i=rows.length-1;
        while (i>=0) {
            sum = sum + Math.pow(getter(n.data_src[rows[i]]) - mean,2);
            i--;
        }
        let sd = Math.sqrt(sum / rows.length);

        stats[col] = {mean: mean,
                       max: getter(n.data_src[rows[0]]),
                       min: getter(n.data_src[rows[rows.length-1]]),
                       median: getter(n.data_src[rows[Math.floor(rows.length/2.0)]]),
                       sd: sd };
        stats[col].scale = d3.scaleLinear().domain([stats[col].min, stats[col].max]).range([0, 1]);


    }

    let pop_cutoff = 0.3;
    let rating_cutoff = 3.9;

    for (let k=0; k<VALID_NOM_COLUMNS.length; k++) {
        let col = VALID_NOM_COLUMNS[k];

        let raw_counts = {};
        let popular_counts = {};
        let best_counts = {};
        let ranked_by_genre = {};
        let best_in_cat = {};
        let most_pop_in_cat = {};

        let i=rows.length-1;
        while (i>=0) {
            let row = rows[i];
            let k = n.data_src[row][col].length-1;
            let dat = n.data_src[row][col];
            if (dat.constructor !== Array) {
                k=0;
                dat = [ n.data_src[row][col] ];
            }

            while (k>=0) {
                let v = dat[k];
                let popular = DESC_STATS['num_reviews'].scale(parseFloat(n.data_src[row]['num_reviews']));
                let rating = parseFloat(n.data_src[row]['rating']);
                let rank = LEAFROW_TO_NODE[row].rank;

                if (!(v in raw_counts)) {
                    raw_counts[v] = 0;
                    popular_counts[v] = 0;
                    best_counts[v] = 0;
                    ranked_by_genre[v] = [];
                    best_in_cat[v] = ['',Number.MAX_VALUE];
                    most_pop_in_cat[v] = ['',-1];
                }

                if (rank < best_in_cat[v][1]) {
                    best_in_cat[v] = [row, rank];
                }
                if (popular > most_pop_in_cat[v][1]) {
                    most_pop_in_cat[v] = [row, popular];
                }

                raw_counts[v] = raw_counts[v] + 1;
                ranked_by_genre[v].push(row);
                if (popular >= pop_cutoff) {
                    popular_counts[v] = popular_counts[v] + 1;
                }
                if (rating >= rating_cutoff) {
                    best_counts[v] = best_counts[v] + 1;
                }

                k--;
            }
            i--;
        }


        let common = null;
        let most_count = -1;
        for (let col in raw_counts) {
            if (raw_counts[col] > most_count) {
                common = col;
                most_count = raw_counts[col];
            }
        }

        for (let col in ranked_by_genre) {
            ranked_by_genre[col].sort(function(a,b) {
                return LEAFROW_TO_NODE[a].rank - LEAFROW_TO_NODE[b].rank;
            });
        }


        stats[col] = {
            most_common: common,
            majority_col: ((raw_counts[common] / rows.length) >= 0.5 ? common : null),
            count: raw_counts,
            popular: popular_counts,
            high_rated: best_counts,
            ranked: ranked_by_genre,
            top_ranked: best_in_cat,
            top_popular: most_pop_in_cat
        };
    }


    let cluster_rank = {};
    rows.sort(function(a,b) { return LEAFROW_TO_NODE[a].rank - LEAFROW_TO_NODE[b].rank; });
    for (let k = 0; k<rows.length; k++) {
        cluster_rank[rows[k]] = k;
    }
    CLUSTER_STATS["*node_rank"];






    CLUSTER_STATS[n.id] = stats;
    //console.log(CLUSTER_STATS);
    return stats;

}

function updateLeafRankings() {

    let scratch = LEAF_NODES.slice();

    //debug
    scratch.sort(function(a,b) {return b.rank - a.rank;});
    let t =[];
    let q=0;
    while(q<scratch.length) {
        t.push(DATASET[scratch[q].data_rows[0]].name);
        q++;
    }
    //console.log(t);


    //for now leaving out BOUNDS since it makes the recommendation unstable when panning
    function modelScore(rating, reviews, ranking, picNum, snipNum) {
        //range from 1 to 5.6
        return (rating +
                DESC_STATS['num_reviews'].scale(reviews) * 1.3 + //reviews can boost up or down a score
                DESC_STATS['images'].scale(picNum) * 0.2 + //pictures boost scores
                DESC_STATS['highlights'].scale(snipNum) * 0.5 +
                DESC_STATS['ranking'].scale(ranking) * - 1) / 7.0;

    }

    function userScore(rows) {

        if (activeWeights.length > 0) {
            let avg = 0;
            for (let w of activeWeights) {

                avg = avg + w.weightFunction(rows).weight;

            }
            return 1.5 * avg / activeWeights.length;
        }
        else {
            return 0;
        }
    }

    scratch.sort( function(a,b) {
        let aRating = a.data_src[a.data_rows[0]]['rating'];
        let bRating = b.data_src[b.data_rows[0]]['rating'];
        let aReviews = a.data_src[a.data_rows[0]]['num_reviews'];
        let bReviews = b.data_src[b.data_rows[0]]['num_reviews'];
        let aRanking = a.data_src[a.data_rows[0]]['ranking'];
        let bRanking = b.data_src[b.data_rows[0]]['ranking'];
        let aSnips = a.data_src[a.data_rows[0]]['highlights'].length;
        let bSnips = b.data_src[b.data_rows[0]]['highlights'].length;
        let aPics = a.data_src[a.data_rows[0]]['images'].length;
        let bPics = b.data_src[b.data_rows[0]]['images'].length;

        return (modelScore(bRating, bReviews, bRanking, bPics, bSnips) + userScore(b.data_rows)) -
               (modelScore(aRating, aReviews, aRanking, aPics, aSnips) + userScore(a.data_rows));
    });



    //update the ranking value in the nodes
    t =[];
    let i=0;
    while(i<scratch.length) {
        scratch[i].rank = i+1;
        t.push(DATASET[scratch[i].data_rows[0]].name);

        i++;
    }


}


function explainLeaf(leafNode) {
    let cluster = LEAFROW_TO_CURRENT_CLUSTER[leafNode.data_rows[0]];
    //ignoring user level features for now
    let datarow = leafNode.data_rows[0];

    //overall stats
    let overall_list = {
        node_id: leafNode.id,
        row_id: datarow,
        top10: parseFloat(leafNode.data_src[datarow]['ranking']) <= 10,
        rating: DESC_STATS['rating'].scale(parseFloat(leafNode.data_src[datarow]['rating'])) >= 0.9,
        rating_quartile: Math.floor(DESC_STATS['rating'].scale(parseFloat(leafNode.data_src[datarow]['rating'])) / 0.25),
        popularity: DESC_STATS['log_num_reviews'].scale(Math.log(parseFloat(leafNode.data_src[datarow]['log_num_reviews']))) >= 0.75,
        affordable: DESC_STATS['price_numeric'].scale(parseFloat(leafNode.data_src[datarow]['price_numeric'])) <= 0.25,
        pricey: DESC_STATS['price_numeric'].scale(parseFloat(leafNode.data_src[datarow]['price_numeric'])) >= 0.75,
        first_cat: leafNode.data_src[datarow]['first_category'],
        genre_top10: [],
        genre_best: [],
        genre_rare: [],
        //NEED TO INCLUDE POPULARITY HERE
        neighborhood_best: "",
        neighborhood_top10: "",

    };
    if (overall_list.first_cat.endsWith("s")) { overall_list.first_cat = overall_list.first_cat.slice(0,-1); }
    for (let cat of leafNode.data_src[datarow]['categories']) {
        let disp = cat;
        if (cat.endsWith("s")) { disp = cat.slice(0,-1); }
        if (DESC_STATS['categories']['ranked'][cat].indexOf(datarow) < 10 &&
            DESC_STATS['categories']['count'][cat] > 20) {
                overall_list.genre_top10.push(disp);
        }
        if (DESC_STATS['categories']['ranked'][cat].indexOf(datarow) === 0 &&
            DESC_STATS['categories']['count'][cat] > 7) {
                overall_list.genre_best.push(disp);
        }
        if (DESC_STATS['categories']['count'][cat] < 4) {
            overall_list.genre_rare.push(disp);
        }
    }
    let neighborhood = leafNode.data_src[datarow]['neighborhood'];
    if (neighborhood.length > 0) {
        if (DESC_STATS['neighborhood']['ranked'][neighborhood].indexOf(datarow) < 10 &&
            DESC_STATS['neighborhood']['count'][neighborhood] > 20) {
                overall_list.neighborhood_top10 = neighborhood;
        }
        if (DESC_STATS['neighborhood']['ranked'][neighborhood].indexOf(datarow) === 0 &&
            DESC_STATS['neighborhood']['count'][neighborhood] > 6) {
                overall_list.neighborhood_best = neighborhood;
        }
    }

    //as compared to cluster
    let cstat = clusterStats(cluster);

    //fill in later

    let modifier = "";
    if (overall_list.top10) {
        modifier = "top 10 ";
    }
    else if (overall_list.popularity) {
        modifier = "popular ";
    }
    else if (overall_list.rating) {
        modifier = "excellent rating ";
    }
    else if (overall_list.affordable) {
        modifier = "affordable ";
    }
    else if (overall_list.pricey) {
        modifier = "upscale ";
    }
    else {
        if (overall_list.rating_quartile === 0) {
            modifier = "poorly rated ";
        }
        else if (overall_list.rating_quartile === 1 ) {
            modifier = "below average ";
        }
        else if (overall_list.rating_quartile === 2 ) {
            modifier = "above average ";
        }
        else if (overall_list.rating_quartile === 3 ) {
            modifier = "highly rated ";
        }
    }






        //scan for genre first
        let genre_keyword = "";
        let foundGenre = false;
        let match = false;
        for (let w of activeWeights) {
            if (w.needsNomColor) {
                foundGenre = true;
                if (w.weightFunction([datarow]).weight > 0.1) {
                    genre_keyword = w.name + " &";
                    match = true;
                    break;
                }
            }
        }
        if (foundGenre && !match) {
            genre_keyword = "not a selected genre, but";
        }

        let mw = -1;
        let attrib = "";
        let intensity = "";
        for (let w of activeWeights) {
            if (!w.needsNomColor) {
                let weight = w.weightFunction([datarow]).weight;
                if (weight > mw && weight > 0) {
                    mw = weight;
                    attrib = w.explanationsuffix;
                    console.log(weight);
                    console.log(Math.ceil(weight / 0.25)-1);
                    intensity = w.intensityterms[Math.ceil(weight / 0.25)-1] + " ";
                }
            }
        }

    if (genre_keyword.length > 0 && attrib.length > 1) {
        return genre_keyword + " " + intensity + attrib;
    }
    if (genre_keyword.length > 0 && attrib.length < 1) {
        return genre_keyword + " " + modifier;
    }
    else if (genre_keyword.length < 1 && attrib.length > 0) {
        return intensity + attrib;
    }
    else {

        if (overall_list.genre_best.length > 0) {
            if (overall_list.first_cat in overall_list.genre_best) {
                return "Best "+overall_list.genre_best[overall_list.genre_best.indexOf(overall_list.first_cat)]+" in town";
            }
            else {
                return "Best "+overall_list.genre_best[0]+" in town";
            }
        }
        if (overall_list.neighborhood_best.length > 0) {
            return "Best restaurant in "+overall_list.neighborhood_best;
        }
        if (overall_list.genre_top10.length > 0) {
            return "Top 10 "+overall_list.genre_top10[0]+" in town";
        }
        if (overall_list.genre_top10.length > 0) {
            return "Top 10 in "+overall_list.neighborhood_top10;
        }
        if (overall_list.genre_rare.length > 0) {
            return overall_list.genre_rare[0]+" food is uncommon";
        }
        return modifier + overall_list.first_cat + "";
    }







}






function scoreNodes(data, slicedNodes) {

    //standard error of mean for all numeric columns
    let errors = {};
    let means = {};
    let i=0;
    while (i<VALID_NUM_COLUMNS.length) {
        let col = VALID_NUM_COLUMNS[i];

        let pop_mean = DESC_STATS[col].mean;
        let pop_sd = DESC_STATS[col].sd;
        //console.log(col,pop_mean, pop_sd);

        let j=0;
        while (j<slicedNodes.length) {
            let node = slicedNodes[j];

            if (!(node.id in errors)) {
                errors[node.id] = {};
            }
            if (!(node.id in means)) {
                means[node.id] = {};
            }

            if (node.data_rows.length > 1 && !(col in errors[node.id])) {
                let n = node.data_rows.length;
                let node_mean = d3.mean(node.data_rows, function(d) {return data[d][col];});
                let node_sd = d3.deviation(node.data_rows, function(d) {return data[d][col];});

                let z = (node_mean - pop_mean) / (pop_sd / n);
                //console.log(col, node.id, n, node_mean, node_sd, z);
                means[node.id][col] = node_mean;
                errors[node.id][col] = z;

            }

            j++;
        }

        i++;
    }

    //tf-idf ish for all nom columns
    // for now we normalize the counts rather than using raw counts
    let tfidf = {};
    i=0;
    while (i<VALID_NOM_COLUMNS.length) {
        let col = VALID_NOM_COLUMNS[i];

        /*
        let pop_frequencies = {};
        let max_freq = 0;
        let n=data.length-1;
        while (n>=0) {
            for (let v of data[n][col]) {

                if (!(v in pop_frequencies)) {
                    pop_frequencies[v] = 0;
                }
                pop_frequencies[v] = pop_frequencies[v] + 1;
                if (pop_frequencies[v] > max_freq) {
                    max_freq = pop_frequencies[v];
                }
            }

            n--;
        }

        //console.log(pop_frequencies);
        */

        //gather node and doc frequencies
        let doc_frequencies = {};
        let doc_count = 0;
        let j=0;
        while (j<slicedNodes.length) {
            let node = slicedNodes[j];

            if (!(node.id in tfidf)) {
                tfidf[node.id] = {};
            }

            if (node.data_rows.length > 1 && !(col in tfidf[node.id])) {
                let n = node.data_rows.length;
                doc_count++;

                let node_frequencies = {};
                let node_max_freq = 0;
                let terms = [];
                let k=node.data_rows.length-1;
                while (k>=0) {
                    for (let v of data[node.data_rows[k]][col]) {

                        if (!(v in node_frequencies)) {
                            node_frequencies[v] = 0;
                            terms.push(v);
                        }
                        node_frequencies[v] = node_frequencies[v] + 1;
                        if (node_frequencies[v] > node_max_freq) {
                            node_max_freq = node_frequencies[v];
                        }
                    }

                    k--;
                }

                let term_frequencies = {};
                k = terms.length-1;
                while (k>=0) {
                    let term = terms[k];

                    //filter out small terms?
                    //do we want to influence the term freq by factors like rating etc
                    let term_freq = (node_frequencies[term] / node_max_freq);
                    //let term_freq = 0.5 + (0.5 * (node_frequencies[term] / node_max_freq));
                    term_frequencies[term] = term_freq;

                    if (!(term in doc_frequencies)) {
                        doc_frequencies[term] = 0;
                    }
                    doc_frequencies[term] = doc_frequencies[term] + 1;

                    k--;
                }

                //console.log(term_frequencies);
                tfidf[node.id][col] = term_frequencies;

            }

            j++;
        }
        //compute inverted doc frequencies
        for (let term in doc_frequencies) {
            doc_frequencies[term] = Math.log((doc_count+1)/(doc_frequencies[term]+1));
        }

        //now make the tf-idf
        j=0;
        while (j<slicedNodes.length) {
            let node = slicedNodes[j];

            if (node.data_rows.length > 1) {
                for (let term in tfidf[node.id][col]) {
                    tfidf[node.id][col][term] = tfidf[node.id][col][term] * doc_frequencies[term];
                }
            }

            //console.log(tfidf[node.id][col]);
            j++;

        }




        i++;
    }


    RAW_SCORES = {  means: means,
                    errors: errors,
                    tfidf: tfidf };




}






















// ---------------- END DATA FEATURE EXTRACTION ------------













function SVGOverlay (map, data) {
    this.data = data;
    this.map = map;
    this.svg = null;
    this.recentlyZoomed = false;
    this.slicedNodes = [];
    this.last_layout_bounds = null;

    this.CANVAS_TILE_DB = {};  //db->node_id->tiles_for_node
    this.currentCanvasTiles = null;

    this.onPan = this.onPan.bind(this);
    this.onBoundsChanged = this.onBoundsChanged.bind(this);
    this.onZoomStarted = this.onZoomStarted.bind(this);
    this.onZoomFinished = this.onZoomFinished.bind(this);
    this.onMouseClick = this.onMouseClick.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);


    this.setMap(map);
}

SVGOverlay.prototype = new google.maps.OverlayView();





SVGOverlay.prototype.updateLeavesOnscreen = function() {
    //march through quadtree to keep running list of all leaves onscreen
    let bounds = this.map.getBounds();
    let latMin = Math.min(bounds.getSouthWest().lat(), bounds.getNorthEast().lat());
    let latMax = Math.max(bounds.getSouthWest().lat(), bounds.getNorthEast().lat());
    let lonMin = Math.min(bounds.getSouthWest().lng(), bounds.getNorthEast().lng());
    let lonMax = Math.max(bounds.getSouthWest().lng(), bounds.getNorthEast().lng());


    LEAVES_ONSCREEN = [];
    LEAF_QUAD_TREE.visit(function(node, x1, y1, x2, y2) {
    if (!node.length) {
      do {
        let d = node.data;
        let lat = d.data_src[d.data_rows[0]][LATVAL];
        let lon = d.data_src[d.data_rows[0]][LONVAL];
        if ((lat > latMin) && (lat < latMax) && (lon > lonMin) && (lon < lonMax)) {
            LEAVES_ONSCREEN.push(d);
        }
      } while (node = node.next);
    }
    return x1 >= lonMax || y1 >= latMax || x2 < lonMin || y2 < latMin;
    });

};


SVGOverlay.prototype.updateClustersOnscreen = function() { //uses this.slicedNodes
    //march through quadtree to keep running list of all leaves onscreen
    let bounds = this.map.getBounds();
    let latMin = Math.min(bounds.getSouthWest().lat(), bounds.getNorthEast().lat());
    let latMax = Math.max(bounds.getSouthWest().lat(), bounds.getNorthEast().lat());
    let lonMin = Math.min(bounds.getSouthWest().lng(), bounds.getNorthEast().lng());
    let lonMax = Math.max(bounds.getSouthWest().lng(), bounds.getNorthEast().lng());
    let latPad = (latMax - latMin) * 0.05;
    let lonPad = (lonMax - lonMin) * 0.05;
    latMin -= latPad;
    latMax += latPad;
    lonMin -= lonPad;
    lonMax += lonPad;

    let singles = [];
    let multiples = [];
    let i=this.slicedNodes.length-1;
    while(i>=0) {
        let n = this.slicedNodes[i];
        if (n.data_rows.length < 2) {

          let lat = n.data_src[n.data_rows[0]][LATVAL];
          let lon = n.data_src[n.data_rows[0]][LONVAL];
          if ((lat > latMin) && (lat < latMax) && (lon > lonMin) && (lon < lonMax)) {
              singles.push(n);
          }
        }
        else {
            let rect = n.getHullBoundingBox(LATVAL, LONVAL);
            let onscreen = true;
            if (rect[0] > latMax || latMin > rect[2]) {
                onscreen = false;
            }
            if (rect[1] > lonMax || lonMin > rect[3]) {
                onscreen = false;
            }
            if (onscreen) {
                multiples.push(n);
            }
        }

        i--;
    }

    CLUSTERS_ONSCREEN = {singletons: singles, clusters: multiples};

};

SVGOverlay.prototype.onZoomStarted = function () {
    //console.log('***ZOOM   -----'+this.map.getZoom());

    this.recentlyZoomed = true;

};


SVGOverlay.prototype.onAdd = function () {
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    //this.svg.style.position = 'absolute';
    //this.svg.style.top = '8px';
    //this.svg.style.left = '8px';
    //this.svg.style.zIndex = 100;
    //this.svg.style.pointerEvents = 'none';
    this.svg.id = "mapSVG"
    //this.width = 1100;
    //this.height = 600;


    /*d3.select(this.svg)
        .attr('width', 1100)
        .attr('height', 600);*/


    d3.select(this.svg)
        .append('g')
        .attr('id', 'region_overlay')
        .attr('x_offset', 0)
        .attr('y_offset', 0);


    d3.select(this.svg)
        .append('g')
        .attr('id', 'circles_overlay')
        .attr('x_offset', 0)
        .attr('y_offset', 0);

    d3.select(this.svg)
        .append('g')
        .attr('id', 'animation_overlay')
        .attr('x_offset', 0)
        .attr('y_offset', 0);


    d3.select(this.svg)
        .append('g')
        .attr('id', 'selection_overlay')
        .attr('x_offset', 0)
        .attr('y_offset', 0);

    d3.select(this.svg)
        .append('g')
        .attr('id', 'recommendation_overlay')
        .attr('x_offset', 0)
        .attr('y_offset', 0);


    d3.select(this.svg)
        .append('defs')
        .attr('id', 'path_defs');

    d3.select("#popoverContainer")
        .attr("width", "100%")
        .attr("height", "100%");

    d3.select("#popoverLines")
        .attr("width", "100%")
        .attr('height', "100%");

    d3.select("#canvasContainer")
        .attr('x_offset', 0)
        .attr('y_offset', 0);

    d3.select('#region_overlay').attr('class', 'coords');

    var projection = this.getProjection();


    this.popoverNodes = [];


    this.slicedNodes = ROOT_NODES;


    document.getElementById("svgPositioner").appendChild(this.svg);


    this.onPan();
    this.map.addListener('center_changed', this.onPan);
    this.map.addListener('zoom_changed', this.onZoomStarted);
    this.map.addListener('bounds_changed', this.onBoundsChanged);
    this.map.addListener('mousemove', this.onMouseMove);
    this.map.addListener('click', this.onMouseClick);


    this.rebuildForceModel();

    buildWeightRows();


    LEAVES_ONSCREEN = LEAF_NODES;

    this.recentlyZoomed = true;


/*
//DEBUG TEST
    for (let i=0; i<4; i++) {
        let container = d3.select('#popoverContainer').append("div");
        this.buildPopover(LEAF_NODES[i], projection, container.node(), true);
    }*/

};


//move outlines during pan so they stay in frame
var FORCED_RESIZE = false;
SVGOverlay.prototype.onBoundsChanged = function () {
    //console.log('***BOUNDS')

    if (this.recentlyZoomed || FORCED_RESIZE) {
        this.recentlyZoomed=false;
        FORCED_RESIZE=false;
        this.onZoomFinished();
    }


    //this.updateRegionView();
    this.updateLeavesOnscreen();
    this.updateClustersOnscreen();
    //console.log(CLUSTERS_ONSCREEN);
    //console.log(LEAVES_ONSCREEN);
    this.updateSideBarWithLeaves(LEAVES_ONSCREEN, false);
    this.updateRecommendedPopovers();



    let bounds = this.map.getBounds();
    //this.updateSlices();


    this.updateForceModelWithNewBounds(bounds);
    this.updatePopoverObjectsFromForce(false, false);



    if (this.last_layout_bounds) {
        translateRegionView(this.last_layout_bounds, bounds);
        this.last_layout_bounds = bounds;
    }
    else {
        this.redrawRegionView(this.last_layout_bounds, bounds);
    }

};


//move outlines during pan so they stay in frame
var PREVIOUS_PX_BOUNDS = [];
var STARTING_ZOOM_SW_REF = null;
SVGOverlay.prototype.onZoomFinished = function () {
    //console.log('***ZOOM_DONE   -----'+this.map.getZoom());
    // var t = this;
    // setTimeout(function() {
    // },1000);
    // */
    // clearExpansion();

    let bounds = this.map.getBounds();
    let latMin = bounds.getSouthWest().lat();
    let latMax = bounds.getNorthEast().lat();
    let lonMin = bounds.getSouthWest().lng();
    let lonMax = bounds.getNorthEast().lng();
    STARTING_ZOOM_SW_REF = bounds.getSouthWest();

    //adjust padding to make sure scrolling pop doesn't happen
    //count stuff 1/2 screen away as visible
    LATPAD = Math.abs(latMax - latMin) * 0.4;
    LONPAD = Math.abs(lonMax - lonMin) * 0.4;

    function isInBounds(lat, lon) {
        if ((lat > latMin) && (lat < latMax) &&
           (lon > lonMin) && (lon < lonMax)) {
            return true;
           }
        else {
            return false;
        }
    }
    function isInBoundsPadded(lat, lon) {
        if ((lat > latMin-LATPAD) && (lat < latMax+LATPAD) &&
           (lon > lonMin-LONPAD) && (lon < lonMax+LONPAD)) {
            return true;
           }
        else {
            return false;
        }
    }



    let viewSize = Math.abs(latMin*10 - latMax*10) * Math.abs(lonMin*10 - lonMax*10);

    //check if we've recently changed zoom amount -- if so, we need to clear the expansion at the start

    let viewSizeChanged = Math.abs(viewSize - PREVIOUS_VIEWSIZE) > 0.01;

    if (viewSizeChanged) { //need big epsilon to fuzz small changes
        clearExpansion();
        //console.log("VIEW_SIZE_CHANGED");
    }
    PREVIOUS_VIEWSIZE = viewSize;


    this.slicedNodes = adjustClusters(this.slicedNodes, viewSize, isInBounds, isInBoundsPadded);


    this.deselectClusters();

    this.last_layout_bounds = null; //wipe past transform on popovers etc
    this.currentCanvasTiles = null;
    this.CANVAS_TILE_DB = {}; //wipe the cache of tiles
    let projection = this.getProjection();
    //this.resetAllPopupPositions( projection );
    //this.layoutPopups( projection );


    //compute rankings, notations, and rendering styles for nodes




    //this.currentCanvasTiles = this.getCanvasTilesForClustersAtCurrentZoom(this.slicedNodes);
    let sizeFunction = function(rows) {
        return DESC_STATS.log_num_reviews.scale(Math.log(DATASET[rows[0]].num_reviews)) * 3 + 2;
    };
    this.generateSVGCirclesForClustersAtCurrentZoom(this.slicedNodes, sizeFunction);

    this.rebuildForceModel();

    /*
    this.updateLeavesOnscreen();
    this.updateSlices();
    // console.log('DONE_ZOOM');



    if (this.last_layout_bounds) {
        translateRegionView(this.last_layout_bounds, bounds);
        this.last_layout_bounds = bounds;
    }
    else {
        this.redrawRegionView(bounds);
    }*/

};



//move outlines during pan so they stay in frame
SVGOverlay.prototype.onPan = function () {
    //console.log('***PAN')

    //this.updateRegionView();
    //this.updateSlices();

};

SVGOverlay.prototype.onRemove = function () {
    this.map.removeListener('center_changed', this.onPan);
    this.svg.parentNode.removeChild(this.svg);
    this.svg = null;
};

//called on zoom events and initial load
SVGOverlay.prototype.draw = function () {

    //console.log("draw_call");

};


SVGOverlay.prototype.clearPopovers = function () {
    d3.selectAll(".popover-wrapper").remove();
};




SVGOverlay.prototype.drawPaths = function (over, bounds) {

    var projection = this.getProjection();
    var svg = d3.select("#region_overlay");


    let orig_corner_proj = projection.fromLatLngToContainerPixel(STARTING_ZOOM_SW_REF);
    let cur_corner_proj = projection.fromLatLngToContainerPixel(bounds.getSouthWest());
    let translate_x = orig_corner_proj.x - cur_corner_proj.x;
    let translate_y = orig_corner_proj.y - cur_corner_proj.y;
    svg.style("transform","translate("+Math.floor(translate_x)+"px,"+Math.floor(translate_y)+"px)");


    svg.selectAll("path.group").data(over).enter().append("path")
        .attr("class", "datapoint group");
        //.attr("d", function(d) {return d.getPathDProj(LATVAL, LONVAL, projection);});

    svg.selectAll("path.group").data(over).exit().remove();

    //if view size changed, update the path variable
    //if (viewSizeChanged) {
        //console.log("buildpaths");

    svg.selectAll("path.group").each( function(d,i) {

        let nid = d3.select(this).attr("c_id");
        if (parseInt(nid) != d.id) {
            //redraw
            d3.select(this).style("transform", "translate("+Math.floor(-translate_x)+"px,"+Math.floor(-translate_y)+"px)")
                    .attr("d", function(d) {return d.getPathDProj(LATVAL, LONVAL, projection);})
                    .attr("c_id",d.id);


        }
        else {
            //do nothing
        }

    });
        /*.on("mouseover", function(d) {
            d3.select(".tooltip").transition()
                .duration(200)
                .style("opacity", .9);
            d3.select(".tooltip").html(d.id)
                .style("left", (d3.event.pageX) + "px")
                .style("top", (d3.event.pageY - 28) + "px");
            })
        .on("mouseout", function(d) {
            d3.select(".tooltip").transition()
                .duration(500)
                .style("opacity", 0);
        });*/
    //}

    //translate them to the proper place without rewriting path (delta from path center to now)
    /*svg.selectAll("path.group").attr("transform", function(d) {
        let c = d.getCenterDProj(LATVAL, LONVAL, projection);
        let delta = [c[0] - d.lastPathCentroid[0],c[1] - d.lastPathCentroid[1]];
        return "translate("+delta[0]+","+delta[1]+')';
    });*/

};

/*

SVGOverlay.prototype.drawSimplePathCanvas = function () {

    let width = 1100;
    let height = 600;

    let canvas = d3.select("#canvasContainer").append("div")
                .attr("class","canvasWrapper")
                .append("canvas").node();
    let context = canvas.getContext("2d");
    d3.timer(redraw);

    function redraw() {
      canvas.width = width*2;
      canvas.height = height*2;
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      let i=LEAVES_ONSCREEN.length-1;
      while (i>=0) {
          draw(LEAVES_ONSCREEN[i]);
          i--;
      }
    }

    let t = this;

    function draw(node) {
        let latLng = new google.maps.LatLng(node.data_src[node.data_rows[0]][LATVAL], node.data_src[node.data_rows[0]][LONVAL]);
        let proj = t.getProjection().fromLatLngToContainerPixel(latLng);

      context.beginPath();
      context.arc(proj.x, proj.y, 4, 0, 2 * Math.PI);
      context.stroke();


    }
}
*/




SVGOverlay.prototype.drawPointwiseCanvases = function (tiles, bounds) {

    //might be faster to draw it all on one big canvas!
    //or use some kind of screen tiling system to queue up stuff that isn't quite onscreen

    //console.log("DRAW CANVAS")
    var projection = this.getProjection();
    var container = d3.select("#canvasContainer");
    let zoom = this.map.getZoom();

    //manage the translation currently on the container
    let orig_corner_proj = projection.fromLatLngToContainerPixel(STARTING_ZOOM_SW_REF);
    let cur_corner_proj = projection.fromLatLngToContainerPixel(bounds.getSouthWest());
    let translate_x = orig_corner_proj.x - cur_corner_proj.x;
    let translate_y = orig_corner_proj.y - cur_corner_proj.y;
    container.style("transform","translate("+Math.floor(translate_x)+"px,"+Math.floor(translate_y)+"px)");


    container.selectAll("div.canvasWrapper").data(tiles).enter().append("div")
        .attr("class", "canvasWrapper").style("position","absolute").append("canvas");

    container.selectAll("div.canvasWrapper").data(tiles).exit().remove();

    container.selectAll("div.canvasWrapper").each( function(d,i) {
        //update canvas contents if need be
        let nids = d3.select(this).property(" __prevNodes__");
        let z = d3.select(this).attr("z_level");
        let sameNode = true;
        if (nids && nids.length === d.node_id.length) {
                let sum = 0;
                var t = nids.length-1;
                while (t>=0) { sum += parseInt(nids[t]); t--; }
                if (sum != d.node_sum) {
                    sameNode = false;
                }
            //HACK - Yes, this may be wrong rarely, but it is faster. Yell at me when it bugs out
            /*
            for (let id1 of nids) {
                if (!d.node_id.includes(id1)) {
                    sameNode = false;
                    break;
                }
            }*/
        }
        else { sameNode = false; }

        if (!sameNode || z === "" || parseInt(z) != zoom) {
            //console.log("redrawing tile");
            d3.select(this).property(" __prevNodes__", function(d){ return d.node_id; } );

            d3.select(this).attr("z_level", zoom);

            let canvas = d3.select(this).select("canvas").node();

            canvas.width = d.tile_sz+(d.overflow*2);
            canvas.height = d.tile_sz+(d.overflow*2);


            let ctx = canvas.getContext('2d');
            //ctx.clearRect(0, 0, canvas.width, canvas.height);
            /*
            let j=d.circles.length-1;
            while (j>=0) {
                let c=d.circles[j];



                ctx.fillStyle = colorForNode(c.data_row);
                ctx.beginPath();
                ctx.arc(Math.floor(c.ox+d.overflow),Math.floor(c.oy+d.overflow),CIRCLE_SIZE,0,2*Math.PI);
                ctx.stroke();
                ctx.fill();

                j--;
            }*/

            let offscreenData = d.canvas;

            // copy into visual canvas at different position
            ctx.putImageData(offscreenData, 0, 0);

        }

        //move to correct location

        //d3.select(this).style("top", (d.upperLeft.y) + "px")
        //               .style("left", (d.upperLeft.x) + "px");
        if (Math.floor(d.proj.y - d.overflow-translate_y) != parseInt(d3.select(this).style('top'))) {
            d3.select(this).style("top", Math.floor(d.proj.y - d.overflow-translate_y)+"px");
        }
        if (Math.floor(d.proj.x - d.overflow-translate_x) != parseInt(d3.select(this).style('left'))) {
            d3.select(this).style("left", Math.floor(d.proj.x - d.overflow-translate_x)+"px");
        }




    });



};
/*
function updateCanvasPositions(offset_x, offset_y) {

    d3.selectAll(".canvasWrapper").each(function (d,i) {

        d3.select(this).style("top", (this.style.top + offset_y) + "px")
                       .style("left", (this.style.left + offset_x) + "px");

    });

}*/


SVGOverlay.prototype.drawPathLabels = function (over, bounds, viewSize, viewSizeChanged) {

    var projection = this.getProjection();
    var svg = d3.select("#region_overlay");
    let defs = d3.select('#path_defs');





    defs.selectAll("path.outline").data(over).enter().append("path")
        .attr("class", "datapoint outline");

    defs.selectAll("path.outline").data(over).exit().remove();

    defs.selectAll("path.outline")
        .attr('id', function(d) { return 'outline_'+d.id;})
        .attr("d", function(d) { return d.getExpandedPathDProj(LATVAL, LONVAL, projection,12);});


    //update the textual labels for each cluster
    svg.selectAll("g.labels").data(over).enter().append("g")
        .attr("class", "container labels");

    svg.selectAll("g.labels").data(over).exit().remove();

    svg.selectAll("g.labels")
        .attr('id', function(d) { return 'labels_'+d.id;})
        .each( function(d, i) {

            let container = d3.select(this);
            let wrapper = d3.select('#outline_'+d.id);

            //check for overlap of wrapper and other wrappers
            //let's use a naive stepping algorithm to make life easier
            let a = wrapper.node().getBBox();
            let intersections = [];
            let safeStart = 0; //percent of area that is good start
            let safeEnd = 1; //percent of area that is good end

            svg.selectAll("path.group").each( function(e, j) {

                let b = d3.select(this).node().getBBox();

                if ((Math.abs(a.x - b.x) * 2 < (a.width + b.width)) &&
                    (Math.abs(a.y - b.y) * 2 < (a.height + b.height)) &&
                    e.id != d.id) {

                        intersections.push(b);

                }
            });
            //console.log(intersections);
            //step through the path and check if in bounding boxes
            if (intersections.length > 0) {
                let len = wrapper.node().getTotalLength();
                let stepSize = len * 0.1; //config steps here
                let step = 0;
                let stepLog = [];
                while (step <= len) {

                    let p = wrapper.node().getPointAtLength(step);
                    let intersected = false;
                    //test to see if point in any intersected bbox
                    for(let x=0; x<intersections.length; x++) {
                        let bbox = intersections[x];

                        if (p.x >= bbox.x && p.x <= bbox.x+bbox.width &&
                            p.y >= bbox.y && p.y <= bbox.y+bbox.height) {
                            intersected = true;
                        }
                    }

                    stepLog.push({s:step, intersection:intersected});

                    step = step + stepSize;
                }
                //go through the steps to determine what the longest "run" is
                //console.log(stepLog);
                if (stepLog.length > 1) {
                    safeStart = 0;
                    safeEnd = 0;
                    let testStart = 0;
                    let testEnd = 0;
                    let n = 1;
                    while (n < stepLog.length * 2) { //go past length to handle loops around end
                        let step = stepLog[n % stepLog.length].s;
                        let intersect = stepLog[n % stepLog.length].intersection;
                        if (n >= stepLog.length) { //expand results past the endpoint
                            step = step + len;
                        }
                        //console.log(step);

                        //if we have an intersection, the segment ends
                        if (intersect) {
                            if (Math.abs(safeEnd-safeStart) < Math.abs(testEnd-testStart)) {
                                safeEnd = testEnd;
                                safeStart = testStart;
                            }
                            if (n >= stepLog.length) {
                                //if we hit an intersection after looping around, that's it
                                break;
                            }
                            testStart = -1;
                            testEnd = -1;
                        }
                        else {
                            //otherwise extend the segment
                            if (testStart < 0) {
                                testStart = step;
                            }
                            testEnd = step;
                        }
                        n++;

                    }
                    if (Math.abs(safeEnd-safeStart) < Math.abs(testEnd-testStart)) {
                                safeEnd = testEnd;
                                safeStart = testStart;
                    }
                    //console.log(safeStart, safeEnd);

                    safeStart = safeStart / len;
                    safeEnd = safeEnd / len;
                    //note that safeEnd could be >1
                    //console.log(safeStart, safeEnd);
                }

            }



            //refresh model and compose text labels
            container.selectAll('text.label').data(["Testing, 123"]).enter()
                .append("text")
                .attr("class", "label")
                .append("textPath");

            container.selectAll('text.label').data(["Testing, 123"]).exit().remove();

            container.selectAll('text.label textPath')
                .attr("startOffset","50%")
                .attr('xlink:href', '#outline_'+d.id)
                .text("");

            /*container.append('text')
                .append('textPath')
                .attr({
                  startOffset: '50%',
                  'xlink:href': '#outline_'+d.id
                })
                .text('Hello, world!');*/



    });

};


SVGOverlay.prototype.drawRecommended = function (recommended_nodes, bounds) {

    if (!SHOULD_SHOW_POPOVERS) {
        recommended_nodes = [];
        this.clearPopovers();
    }

    var projection = this.getProjection();
    var svg = d3.select("#recommendation_overlay");

    svg.selectAll("circle.recommended").data(recommended_nodes).enter().append("circle")
            .attr("class", "recommended")
            .attr('stroke', '#444')
            .attr('stroke-width', '1px')
            .attr('opacity', 1e-6)
            .attr('r', 6).each(function () {
                $(this).velocity({opacity : 1}, 500, "swing");
            });
    svg.selectAll("circle.recommended").data(recommended_nodes).exit()
            .attr("opacity", 1).each(function () {
                $(this).velocity({opacity : 1e-6}, 500, "swing", function() { $(this).remove(); });
            });

    this.repositionRecommended(bounds);
};

SVGOverlay.prototype.repositionRecommended = function (bounds) {

    var projection = this.getProjection();
    var svg = d3.select("#recommendation_overlay");

    svg.selectAll("circle.recommended").each( function (fn,i) {
        let d = fn.node_ref;
        let latLng = new google.maps.LatLng(d.data_src[d.data_rows[0]][LATVAL], d.data_src[d.data_rows[0]][LONVAL]);
        let loc = projection.fromLatLngToContainerPixel(latLng);

        d3.select(this).attr('cx',loc.x)
                       .attr('cy',loc.y)
                       .style("fill", fn.color_string);


    });

};




























SVGOverlay.prototype.redrawRegionView = function (old_bounds, new_bounds) {
    //console.log("redraw");
    //ought to move everything from update to redraw/translate for better performance
    //also need better cleaning/identifying things that are going to be onscreen

    let projection = this.getProjection();
    let bounds = this.map.getBounds();


    this.drawPaths(CLUSTERS_ONSCREEN.clusters, bounds);

    //just move around the recommended circle

    //let tiles = this.fetchOnlyOnscreenTilesAndRender(this.currentCanvasTiles, this.map.getBounds(), false, {});
    //this.drawPointwiseCanvases(tiles, bounds);
    let colorFunction = function(rows) {
        let v = DESC_STATS['rating'].scale(DATASET[rows[0]]['rating']);
        if (v < 0.5) {
            return d3.interpolateLab("#d8342c","#f2f2f2")(v*2.0);
        }
        else {
            return d3.interpolateLab("#f2f2f2","#4a76b5")((v-0.5)*2.0);
        }
    };
    this.updateSVGCirclesOnScreen();


    if (old_bounds) {

        let old_proj = projection.fromLatLngToContainerPixel(old_bounds.getSouthWest());
        let new_proj = projection.fromLatLngToContainerPixel(new_bounds.getSouthWest());

        let offset = {x: new_proj.x - old_proj.x, y: new_proj.y - old_proj.y};

        this.repositionRecommended(bounds);
    }

    //draw the canvases


};


SVGOverlay.prototype.translateRegionView = function (old_bounds, new_bounds) {

    //need to implement pass to check if need to render new items that have come onscreen

    //console.log("translate");
    let projection = this.getProjection();
    let bounds = this.map.getBounds();

    let old_proj = projection.fromLatLngToContainerPixel(old_bounds.getSouthWest());
    let new_proj = projection.fromLatLngToContainerPixel(new_bounds.getSouthWest());

    let offset = {x: new_proj.x - old_proj.x, y: new_proj.y - old_proj.y};



    let colorFunction = function(rows) {
        let v = DESC_STATS['rating'].scale(DATASET[rows[0]]['rating']);
        if (v < 0.5) {
            return d3.interpolateLab("#d8342c","#f2f2f2")(v*2.0);
        }
        else {
            return d3.interpolateLab("#f2f2f2","#4a76b5")((v-0.5)*2.0);
        }
    };
    this.updateSVGCirclesOnScreen();

/*
    if (this.currentCanvasTiles) {
        let tiles = fetchOnlyOnscreenTilesAndRender(this.currentCanvasTiles, this.map.bounds, false, {});
        this.drawPointwiseCanvases(tiles, bounds);
    }
    else {
        this.currentCanvasTiles = getCanvasTilesForClustersAtCurrentZoom(over);
        let tiles = fetchOnlyOnscreenTilesAndRender(this.currentCanvasTiles, this.map.bounds, false, {});
        this.drawPointwiseCanvases(tiles, bounds);
    }*/



};





var CURSOR_MAX_RAD = 18;
var CURSOR_MAX_RAD2 = CURSOR_MAX_RAD * 2;

SVGOverlay.prototype.onMouseMove = function (e) {

    let projection = OVERLAY.getProjection();
    let loc = projection.fromLatLngToContainerPixel(e.latLng);
    let translate_x = parseInt($("#circles_overlay").attr("t_x"));
    let translate_y = parseInt($("#circles_overlay").attr("t_y"));
    let mx = Math.round(Math.abs(loc.x)) - translate_x;
    let my = Math.round(Math.abs(loc.y)) - translate_y;
    //console.log(translate_x, translate_y);

    //define bounding box for
    let left = mx - CURSOR_MAX_RAD;
    let right = mx + CURSOR_MAX_RAD;
    let top = my - CURSOR_MAX_RAD;
    let bot = my + CURSOR_MAX_RAD;

    let closestContain = null;
    let closestContainD = Number.MAX_VALUE;
    let closestIntersect = null;
    let closestIntersectD = Number.MAX_VALUE;
    let secondClosestIntersect = null;
    let secondClosestIntersectD = Number.MAX_VALUE;
    let cont = [];
    circle_quad_tree.visit(function(node, x1, y1, x2, y2) {
    if (!node.length) {
      do {
        let d = node.data;
        let x = d.x;
        let y = d.y;
        if (d.opaque && (x >= left) && (x < right) && (y >= top) && (y < bot)) {
            let dist = Math.sqrt((x - mx) * (x - mx) + (y - my) * (y - my));
            let intersect = Math.abs(dist);
            let contain = Math.abs(dist+d.r);
            if (dist < d.r) {
                intersect = d.r-dist;
            }
                cont.push(d.i + " - " +dist);

            if (contain < closestContainD) {
                closestContain = node.data;
                closestContainD = contain;
            }

            if (intersect < closestIntersectD) {
                secondClosestIntersect = closestIntersect;
                secondClosestIntersectD = closestIntersectD;
                closestIntersect = node.data;
                closestIntersectD = intersect;
            }

        }
      } while (node = node.next);
    }
    return x1 >= right || y1 >= bot || x2 < left || y2 < top;
    });
    //console.log(cont)


    $("#circles_overlay circle.selected").removeClass("selected");
    $("#tooltips").empty();

    if (closestContain == null && secondClosestIntersect == null) {
        d3.select("#bubblecursor").remove();
    }
    else {

        //modify the radius so we get a cleaner selection
        let bubblerad = Math.round(Math.max(1, Math.min(closestContainD, secondClosestIntersectD) - closestIntersect.r*0.25));

        let inside = bubblerad <= closestIntersect.r;

        if ($("#bubblecursor").length < 1) {
            d3.select("#selection_overlay").append("circle")
                                           .attr("id","bubblecursor");
        }
        //console.log(closestIntersect.i)
        d3.select("#bubblecursor").attr('cx', mx + translate_x)
                                  .attr('cy', my + translate_y)
                                  .attr('r', bubblerad);

        $("#circles_overlay circle[i='"+closestIntersect.i+"']").addClass("selected");
        /*
        d3.select("#bubblecursor").attr('cx', closestIntersect.x+translate_x)
                                  .attr('cy', closestIntersect.y+translate_y)
                                  .attr('r', bubblerad);*/

        let virtualrad = Math.max(20, bubblerad);

        /*
        console.log(Math.atan2((closestIntersect.y-my), (closestIntersect.x-mx)) + Math.PI/2);

        let d = Math.sqrt((mx-closestIntersect.x)*(mx-closestIntersect.x) +
                      (my-closestIntersect.y)*(my-closestIntersect.y));
        let a = (virtualrad*virtualrad - closestIntersect.r*closestIntersect.r + d*d)/(2*d);
        let h = Math.sqrt(virtualrad*virtualrad - a*a);
        let p2x = mx + ((closestIntersect.x - mx) * a / d);
        let p2y = my + ((closestIntersect.y - my) * a / d);

        let opposite_x = 2*mx - p2x;
        let opposite_y = 2*my - p2y;*/

        let leftcorner = mx > $("#mapSVG").width()/2.0;//mx-p2x > 0;
        //console.log($("#mapSVG").width()/2.0)


        let nodes = [];
        for (let row of closestIntersect.data_rows) {
            nodes.push(LEAFROW_TO_NODE[row]);
        }
        nodes.sort(function(a,b) {return (a.rank-b.rank);})
        nodes = nodes.slice(0,5);

        let tips = d3.select("#tooltips");

        tips.selectAll(".popover-wrapper").data(nodes).enter().append("div").attr("class","popover-wrapper").attr("node_id",-1);
        tips.selectAll(".popover-wrapper").data(nodes).exit().remove()
        tips.selectAll(".popover-wrapper").each(function(d, i) {

            if (d.id != parseInt(d3.select(this).attr("node_id"))) {
                //changed contents
                d3.select(this).empty;
                OVERLAY.fillSelectionPopover(d, d3.select(this).node());
            }

            //console.log(nodes.indexOf(d));
            let opposite_y;
            let opposite_x;
            let index = nodes.indexOf(d);
            if (nodes.length == 1) {
                opposite_x = mx + translate_x + 40 * Math.cos((1-leftcorner)*Math.PI);
                opposite_y = my + translate_y + 40 * Math.sin(0);

            }
            else if (index === 0) {
                opposite_x = mx + translate_x + 80 * Math.cos((1-leftcorner)*Math.PI);
                opposite_y = my + translate_y + 80 * Math.sin(0);
            }
            else if (index % 2 === 0) {
                opposite_x = mx + translate_x + (20+84*Math.floor(index/2)) * Math.cos((1-leftcorner)*Math.PI+Math.PI*(0.3*Math.floor(index/2)));
                opposite_y = my + translate_y + (20+84*Math.floor(index/2)) * Math.sin((1-leftcorner)*Math.PI+Math.PI*(0.3*Math.floor(index/2)));
            }
            else if (index % 2 === 1) {
                opposite_x = mx + translate_x + (20+84*Math.floor(index/2+1)) * Math.cos((1-leftcorner)*Math.PI-Math.PI*(0.3*Math.floor(index/2+1)));
                opposite_y = my + translate_y + (20+84*Math.floor(index/2+1)) * Math.sin((1-leftcorner)*Math.PI-Math.PI*(0.3*Math.floor(index/2+1)));

            }

            let top = opposite_y-$(this).find(".popover").height() / 2.0;

            let left;
            if (leftcorner) {
                left = opposite_x;
            }
            else {
                left = opposite_x-$(this).find(".popover").width();
            }



            $(this).find(".popover").css("top",top+"px")
                                    .css("left",left+"px"   );

        })



    }








    let cluster_candidate = null;
    if (CLUSTERS_ONSCREEN && CLUSTERS_ONSCREEN.clusters) {
        let i=CLUSTERS_ONSCREEN.clusters.length-1;
        while (i>=0) {
            let clust = CLUSTERS_ONSCREEN.clusters[i];
            if (clust.checkContainment(LATVAL,LONVAL,[e.latLng.lat(),e.latLng.lng()])) {
                cluster_candidate = clust;
                break;
            }
            i--;
        }
        let cluster_id = -1;
        if (cluster_candidate) { cluster_id = cluster_candidate.id; }
        d3.selectAll("path.group")
            .classed("highlighted",false)
            .filter( function(d) { return d.id === cluster_id; })
            .classed("highlighted",true);

        if (cluster_candidate) {
            this.peekCluster(cluster_candidate);
        }

    }


};



SVGOverlay.prototype.peekCluster = function (cluster) {



};

SVGOverlay.prototype.selectCluster = function (cluster) {
    d3.selectAll("path.group")
        .classed("selected",false)
        .filter( function(d) { return d.id === cluster.id; })
        .classed("selected",true);


    let cluster_leaves = [];
    for (let row of cluster.data_rows) {
        cluster_leaves.push(LEAFROW_TO_NODE[row]);
    }
    this.updateSideBarWithLeaves(cluster_leaves, true);
    this.updateRecommendedPopovers();

    clusterStats(cluster);

};

SVGOverlay.prototype.deselectClusters = function () {

    d3.selectAll("path.group")
        .classed("selected",false);


    this.updateSideBarWithLeaves(LEAVES_ONSCREEN, true);
    this.updateRecommendedPopovers();

};






SVGOverlay.prototype.onMouseClick = function (e) {

    /*


    let projection = this.getProjection();
    let loc = projection.fromLatLngToContainerPixel(e.latLng);
    //console.log(e.latLng.lat(),e.latLng.lng());
    let x = Math.round(Math.abs(loc.x));
    let y= Math.round(Math.abs(loc.y));

    //let scores = scoreNodes(DATASET, this.slicedNodes);

    //rankLeaves(LEAF_NODES, this.map.getBounds());

    let foundCluster = false;
    d3.selectAll("path.group").each(function(d,i) {


        if (d.checkContainment(LATVAL,LONVAL,[e.latLng.lat(),e.latLng.lng()])) {


            foundCluster = true;
            if (d3.select(this).classed("selected")) {
                OVERLAY.deselectClusters();
            }
            else {
                OVERLAY.selectCluster(d);
            }


            // console.log(clusterStats(d));
            //
            //
            // let lst = d3.select("#datadump").html("").append("ul");
            // let score = RAW_SCORES;
            //
            // //console.log(score);
            // for (let col of VALID_NUM_COLUMNS) {
            //     lst.append("li").text(col+": M"+score.means[d.id][col]+" E"+score.errors[d.id][col]);
            // }
            // for (let col of VALID_NOM_COLUMNS) {
            //     for (let term in score.tfidf[d.id][col]) {
            //         if (score.tfidf[d.id][col][term] > 0.1) {
            //             lst.append("li").text(term+": "+score.tfidf[d.id][col][term]);
            //         }
            //     }
            // }



        }


    });

    if (!foundCluster) {
        OVERLAY.deselectClusters();
    }

    */

};











//MARK ------------------------------LAYOUT FOR POPUPS






//new force model stuff

//https://bl.ocks.org/cmgiven/547658968d365bcc324f3e62e175709b
function constant(_) {
    return function () { return _; }
}
function rectCollide() {
    var nodes, sizes, masses;
    var size = constant([0, 0]);
    var strength = 1;
    var iterations = 1;

    function force() {
        var node, size, mass, xi, yi;
        var i = -1;
        while (++i < iterations) { iterate(); }

        function iterate() {
            var j = -1;
            var tree = d3.quadtree(nodes, xCenter, yCenter).visitAfter(prepare);

            while (++j < nodes.length) {
                node = nodes[j];
                size = sizes[j];
                mass = masses[j];
                xi = xCenter(node);
                yi = yCenter(node);

                tree.visit(apply);
            }
        }

        function apply(quad, x0, y0, x1, y1) {
            var data = quad.data;
            var xSize = (size[0] + quad.size[0]) / 2;
            var ySize = (size[1] + quad.size[1]) / 2;
            if (data) {
                if (data.index <= node.index) { return; }

                var x = xi - xCenter(data);
                var y = yi - yCenter(data);
                var xd = Math.abs(x) - xSize;
                var yd = Math.abs(y) - ySize;

                if (xd < 0 && yd < 0) {
                    var l = Math.sqrt(x * x + y * y);
                    var m = masses[data.index] / (mass + masses[data.index]);

                    if (Math.abs(xd) < Math.abs(yd)) {
                        node.vx -= (x *= xd / l * strength) * m;
                        data.vx += x * (1 - m);
                    } else {
                        node.vy -= (y *= yd / l * strength) * m;
                        data.vy += y * (1 - m);
                    }
                }
            }

            return x0 > xi + xSize || y0 > yi + ySize ||
                   x1 < xi - xSize || y1 < yi - ySize;
        }

        function prepare(quad) {
            if (quad.data) {
                quad.size = sizes[quad.data.index];
            } else {
                quad.size = [0, 0];
                var i = -1;
                while (++i < 4) {
                    if (quad[i] && quad[i].size) {
                        quad.size[0] = Math.max(quad.size[0], quad[i].size[0]);
                        quad.size[1] = Math.max(quad.size[1], quad[i].size[1]);
                    }
                }
            }
        }
    }

    function xCenter(d) { return d.x + d.vx + sizes[d.index][0] / 2; }
    function yCenter(d) { return d.y + d.vy + sizes[d.index][1] / 2; }

    force.initialize = function (_) {
        sizes = (nodes = _).map(size);
        masses = sizes.map(function (d) { return d[0] * d[1]; });
    };

    force.size = function (_) {
        return (arguments.length
             ? (size = typeof _ === 'function' ? _ : constant(_), force)
             : size);
    };

    force.strength = function (_) {
        return (arguments.length ? (strength = +_, force) : strength);
    };

    force.iterations = function (_) {
        return (arguments.length ? (iterations = +_, force) : iterations);
    };

    return force;
}
function boundedBox() {
    var nodes, sizes
    var bounds
    var size = constant([0, 0])

    function force() {
        var node, size
        var xi, x0, x1, yi, y0, y1
        var i = -1
        while (++i < nodes.length) {
            node = nodes[i]
            size = sizes[i]
            xi = node.x + node.vx
            x0 = bounds[0][0] - xi
            x1 = bounds[1][0] - (xi + size[0])
            yi = node.y + node.vy
            y0 = bounds[0][1] - yi
            y1 = bounds[1][1] - (yi + size[1])
            if (x0 > 0 || x1 < 0) {
                node.x += node.vx
                node.vx = -node.vx
                if (node.vx < x0) { node.x += x0 - node.vx }
                if (node.vx > x1) { node.x += x1 - node.vx }
            }
            if (y0 > 0 || y1 < 0) {
                node.y += node.vy
                node.vy = -node.vy
                if (node.vy < y0) { node.vy += y0 - node.vy }
                if (node.vy > y1) { node.vy += y1 - node.vy }
            }
        }
    }

    force.initialize = function (_) {
        sizes = (nodes = _).map(size)
    }

    force.bounds = function (_) {
        return (arguments.length ? (bounds = _, force) : bounds)
    }

    force.size = function (_) {
        return (arguments.length
             ? (size = typeof _ === 'function' ? _ : constant(_), force)
             : size)
    }

    return force
}


let PAD_NODES = 0;
var force_nodes = []; //store all active nodes in simulation
var force_links = [];
var repelForce = d3.forceManyBody().strength(function(d) {return d.isPop ? -0.1 : -0.04;});
var linkForce = d3.forceLink().iterations(3);
var centerForce = d3.forceCenter();
var boundingForce = boundedBox().size(function (d) { return [d.width, d.height]; });
var collideForce = rectCollide().strength(5).iterations(5).size(function (d) { return [d.width, d.height]; });
var xForce = d3.forceX().strength(0.1);
var yForce = d3.forceY().strength(0.1);

SVGOverlay.prototype.updateForceModelWithNewBounds = function (bounds) {
    let latMin = bounds.getSouthWest().lat();
    let latMax = bounds.getNorthEast().lat();
    let lonMin = bounds.getSouthWest().lng();
    let lonMax = bounds.getNorthEast().lng();
    let latDist = Math.abs(latMax - latMin);
    let lonDist = Math.abs(lonMax - lonMin);
    let latPad = latDist * 0.1;
    let latPadBot = latDist * 0.2; //we want to avoid the bottom so we have room to expand labels
    let lonPad = lonDist * 0.1;

    //if we're gonna pad nodes, do it here to adapt to new bounds

    repelForce.theta(0.001*latDist)
                .distanceMax(latDist*0.4);

    centerForce.x((lonMax+lonMin) / 2.0)
               .y((latMax+latMin) / 2.0);

    linkForce.distance(latDist*0.2);

    boundingForce.bounds([[lonMin+lonPad, latMin+latPadBot], [lonMax-lonPad, latMax-latPad]]);

    xForce.x(function(d) {return d.isPop ? d.l_x + (d.go_left ? -lonDist*0.26 : lonDist*0.15) : 0;});
    yForce.y(function(d) {return d.isPop ? d.l_y + (d.go_up ? -latDist*0.15 : latDist*0.18): 0;});

    /*
    //only reset the model if we're applying boundingForce
    if (FORCE_MODEL) {
        if (FORCE_MODEL.alpha() < FORCE_MODEL.alphaMin()) { //if model has slept
            FORCE_MODEL.restart().alpha(1);
        }
    }*/
};


function point2LatLng(x, y, projection, bounds, zoom) {
  var topRight = projection.fromLatLngToPoint(bounds.getNorthEast());
  var bottomLeft = projection.fromLatLngToPoint(bounds.getSouthWest());
  var scale = Math.pow(2, zoom);
  var worldPoint = new google.maps.Point(x / scale + bottomLeft.x, y / scale + topRight.y);
  return projection.fromPointToLatLng(worldPoint);
}

SVGOverlay.prototype.rebuildForceModel = function () {
    //everything done in lat/lng until we hit position update step
    //always reconstruct FORCE_MODEL
    //console.log("REBUILD FORCE")

    let projection = this.map.getProjection();
    let bounds = this.map.getBounds();
    let zoom = this.map.getZoom();

    this.updateForceModelWithNewBounds(bounds);


    let latMin = bounds.getSouthWest().lat();
    let latMax = bounds.getNorthEast().lat();
    let lonMin = bounds.getSouthWest().lng();
    let lonMax = bounds.getNorthEast().lng();
    let latDist = Math.abs(latMax - latMin);
    let lonDist = Math.abs(lonMax - lonMin);
    let latPad = latDist * 0.3;
    let lonPad = lonDist * 0.3;


    //get size of circle and popup in current projection
    let p1 = point2LatLng(0,0,projection,bounds,zoom);
    let p2 = point2LatLng(10,0,projection,bounds,zoom);
    let circle_width = Math.abs(p2.lng() - p1.lng());
    let circle_height = Math.abs(p2.lat() - p1.lat());

    let i;
    force_nodes = [];
    force_links = [];
    //make fixed nodes for popup sources and nodes for popuprects
    i=this.popoverNodes.length-1;
    while (i>=0) {
        let node = this.popoverNodes[i];
        let centroid = node.getHullCentroid(LATVAL, LONVAL);

        let w = Math.max(144, 24 + Math.min(node.data_src[node.data_rows[0]]['name'].length, 24) * 11);
        let h = (node.data_src[node.data_rows[0]]['name'].length > 24 ? 116 : 98);
        p1 = point2LatLng(0,0,projection,bounds,zoom);
        p2 = point2LatLng(w,h,projection,bounds,zoom);
        let pop_width = Math.abs(p2.lng() - p1.lng());
        let pop_height = Math.abs(p2.lat() - p1.lat());

        let fn = {type : "leaf",
                    x : centroid[1]-circle_width,
                    y : centroid[0]-circle_height,
                    fx : centroid[1]-circle_width,
                    fy : centroid[0]-circle_height,
                    width : circle_width*2,
                    height : circle_height*2,
                    fixed : true,
                    node_id : node.id,
                    node_ref : node};
        let n = {type : "pop",
                    isPop : true,
                    x : centroid[1] - pop_width/2.0 + Math.random()*0.01-0.005,
                    y : centroid[0] - pop_height/2.0 + Math.random()*0.01-0.005,
                    width : pop_width,
                    height : pop_height,
                    l_x : centroid[1]-circle_width,
                    l_y : centroid[0]-circle_width,
                    fixed : true,
                    go_left : Math.random() > 0.5,
                    go_up : Math.random() > 0.5,
                    node_id : node.id,
                    node_ref : node,
                    color_string : POPOVER_PALETTE[PALETTE_INDEX]};
        PALETTE_INDEX = (PALETTE_INDEX + 1) % POPOVER_PALETTE.length;
        let l = {source : fn,
                 target : n};

        force_nodes.push(fn);
        force_nodes.push(n);
        force_links.push(l);

        i--;
    }

    //make fixed nodes for bounding boxes
    /*
    i=this.slicedNodes.length-1;
    while (i>=0) {
        let node = this.slicedNodes[i];
        let bbox = node.getHullBoundingBox(LATVAL, LONVAL);

        let fn = {type : "bbox",
                    x : bbox[1],
                    y : bbox[0],
                    fx : bbox[1],
                    fy : bbox[0],
                    width : Math.abs(bbox[3]-bbox[1]),
                    height : Math.abs(bbox[2]-bbox[0]),
                    fixed : true,
                    node_id : node.id,
                    node_ref : node};

        force_nodes.push(fn);

        i--;
    }*/



    //make links between two
    //must be called whenever we have new links
    linkForce.links(force_links);

    FORCE_MODEL = d3.forceSimulation()
                     //.alphaDecay(0.1)
                     //.force("repelForce",repelForce)
                     //.force("linkForce",linkForce)
                     //.force("centerForce",centerForce)
                     .force("boundingForce",boundingForce)
                     .force("xF",xForce)
                     .force("yF",yForce)
                     .force("collideForce",collideForce)
                     //.on("tick", this.forceTick.bind(this))
                     .nodes(force_nodes)
                     .stop(); //must be called whenever we have new nodes
    //FORCE_MODEL.restart();

    this.iterateForceAndUpdatePopups(false);
};


SVGOverlay.prototype.iterateForceAndUpdatePopups = function (animate) {
    //console.log("iterate");

    //record previous positions for nodes
    let i=force_nodes.length-1;
    while (i>=0) {
        force_nodes[i]['prev_x'] = force_nodes[i].x;
        force_nodes[i]['prev_y'] = force_nodes[i].y;
        i--;
    }

    if (FORCE_MODEL) {

        FORCE_MODEL.nodes(force_nodes);
        linkForce.links(force_links);

        FORCE_MODEL.alpha(1);

        let iters = 0;
        while(iters < 20) {
            FORCE_MODEL.tick();
            iters++;
        }
        FORCE_MODEL.stop();

        //if we're rebuilding, clear out the old popups
        //d3.select("#popoverContainer").selectAll(".popover-wrapper").remove();
        //d3.select("#popoverLines").selectAll("line.edge").remove();
        this.updatePopoverObjectsFromForce(animate, animate);

    }


    //once we've iterated on nodes, freeze them
    i=force_nodes.length-1;
    while (i>=0) {
        force_nodes[i]['fx'] = force_nodes[i].x;
        force_nodes[i]['fy'] = force_nodes[i].y;
        i--;
    }

};

SVGOverlay.prototype.addPopoverToSimulation = function (popNode) {


    let projection = this.map.getProjection();
    let bounds = this.map.getBounds();
    let zoom = this.map.getZoom();

    //get size of circle and popup in current projection
    let p1 = point2LatLng(0,0,projection,bounds,zoom);
    let p2 = point2LatLng(10,10,projection,bounds,zoom);
    let circle_width = Math.abs(p2.lng() - p1.lng());
    let circle_height = Math.abs(p2.lat() - p1.lat());

    let w = Math.max(144, 24 + Math.min(popNode.data_src[popNode.data_rows[0]]['name'].length, 24) * 11);
    let h = (popNode.data_src[popNode.data_rows[0]]['name'].length > 24 ? 116 : 98);
    p1 = point2LatLng(0,0,projection,bounds,zoom);
    p2 = point2LatLng(w,h,projection,bounds,zoom);
    let pop_width = Math.abs(p2.lng() - p1.lng());
    let pop_height = Math.abs(p2.lat() - p1.lat());

    this.popoverNodes.push(popNode);
    let centroid = popNode.getHullCentroid(LATVAL, LONVAL);
    let fn = {type : "leaf",
                x : centroid[1]-circle_width,
                y : centroid[0]-circle_height,
                fx : centroid[1]-circle_width,
                fy : centroid[0]-circle_height,
                width : circle_width*2,
                height : circle_height*2,
                fixed : true,
                node_id : popNode.id,
                node_ref : popNode};
    let n = {type : "pop",
                isPop : true,
                x : centroid[1] - pop_width/2.0 + Math.random()*0.01-0.005,
                y : centroid[0] - pop_height/2.0 + Math.random()*0.01-0.005,
                width : pop_width,
                height : pop_height,
                l_x : centroid[1]-circle_width,
                l_y : centroid[0]-circle_width,
                fixed : true,
                go_left : Math.random() > 0.5,
                go_up : Math.random() > 0.5,
                node_id : popNode.id,
                node_ref : popNode,
                color_string : POPOVER_PALETTE[PALETTE_INDEX]};
    PALETTE_INDEX = (PALETTE_INDEX + 1) % POPOVER_PALETTE.length;
    let l = {source : fn,
             target : n};
    force_nodes.push(fn);
    force_nodes.push(n);
    force_links.push(l);

};

SVGOverlay.prototype.removePopoverFromSimulation = function (popNode) {

    let i=this.popoverNodes.length-1;
    while (i>=0) {
        if (this.popoverNodes[i].id === popNode.id) {
            this.popoverNodes.splice( i, 1 );
        }
        i--;
    }
    i=force_nodes.length-1;
    while (i>=0) {
        if (force_nodes[i].node_id === popNode.id) {
            force_nodes.splice( i, 1 );
        }
        i--;
    }
    i=force_links.length-1;
    while (i>=0) {
        if (force_links[i].source.node_id === popNode.id) {
            force_links.splice( i, 1 );
        }
        i--;
    }


};



SVGOverlay.prototype.updatePopoverObjectsFromForce = function (animateAddRem, animateMove) {
    animateAddRem = false;

    //use enter/exit to create and destroy popupwrappers and links
    var projection = this.getProjection();
    let pop = force_nodes.filter(function(d) {return d.isPop;});
    let popoverContainer = d3.select("#popoverContainer");
    let popoverLineContainer = d3.select("#popoverLines");

    //add
    popoverContainer.selectAll(".popover-wrapper").data(pop).enter()
                        .append("div").attr("class", "popover-wrapper")
                                      .attr("placed", "f")
                                      .attr("node_id", function(d) {return d.node_ref.id;})
                                      .each( function(d,i) {

                            OVERLAY.buildPopover(d.node_ref, projection, this, true);
                            if (animateAddRem) {
                                d3.select(this).select('.popover').style("opacity",0);
                                $(this).find('.popover').velocity({opacity : 1}, 500, "swing");
                            }

                        });
    popoverLineContainer.selectAll("line.edge").data(force_links).enter().append("line")
                .attr("placed", "f")
                .attr("class","edge")
                .attr("fill","none")
                .attr("stroke-width", "2px")
                .each(function() {
                    if (animateAddRem) {
                        d3.select(this).style("opacity",0);
                        $(this).velocity({opacity : 1}, 500, "swing");
                    }
                });

    //remove
    if (animateAddRem) {
        popoverContainer.selectAll(".popover-wrapper").data(pop).exit().style("opacity","1")
                    .each(function () {
                        $(this).velocity({opacity : 0}, 500, "swing", function() { $(this).remove(); });
                    });
        popoverLineContainer.selectAll("line.edge").data(force_links).exit().style("opacity","1")
                    .each(function () {
                        $(this).velocity({opacity : 0}, 500, "swing", function() { $(this).remove(); });
                    });
    }
    else {
        popoverContainer.selectAll(".popover-wrapper").data(pop).exit().remove();
        popoverLineContainer.selectAll("line.edge").data(force_links).exit().remove();
    }
    //modify
    popoverContainer.selectAll(".popover-wrapper").each( function(d, i) {
        //update content
        OVERLAY.updateNotePopoverContent(d.node_ref, this);

        d3.select(this).select(".popover").style("background-color", d.color_string)
                       .select(".expandLabel").style("background-color", d.color_string);

        //popover loc
        let old_latLng = new google.maps.LatLng(d.prev_y,d.prev_x);
        let old_upperLeft = projection.fromLatLngToContainerPixel(old_latLng);
        let old_heiWid = new google.maps.LatLng(d.prev_y+d.height,d.prev_x+d.width);
        let old_lowerRight = projection.fromLatLngToContainerPixel(old_heiWid);

        //record popover element into force_node so links can use it
        //d['popover_old_upperLeft'] = old_upperLeft;
        //d['popover_old_lowerRight'] = old_lowerRight;

        //popover loc
        let latLng = new google.maps.LatLng(d.y,d.x);
        let upperLeft = projection.fromLatLngToContainerPixel(latLng);
        let heiWid = new google.maps.LatLng(d.y+d.height,d.x+d.width);
        let lowerRight = projection.fromLatLngToContainerPixel(heiWid);
        let width = $(this).find(".infobox").outerWidth();
        let height = $(this).find(".infobox").outerHeight();
        let screenwidth = $(this).parent().innerWidth();
        let screenheight = $(this).parent().innerHeight();

        //correct that lowerRight is actually the top (negative lon) HACK - probably depends on hemisphere
        let pos = {x: upperLeft.x, y: lowerRight.y};

        //clamp the position to the edge of the screen
        if (pos.x < 0) {
            pos.x = 0;
        }
        if (pos.y < 0) {
            pos.y = 0;
        }
        if (pos.x + width > screenwidth) {
            pos.x = screenwidth - width;
        }
        if (pos.y + height > screenheight) {
            pos.y = screenheight - height;
        }


        //record popover element into force_node so links can use it
        d['popover_upperLeft'] = pos;
        d['popover_width'] = width;
        d['popover_height'] = height;
        d['popover_old_upperLeft'] = {x: old_upperLeft.x, y: old_lowerRight.y};

        if (animateMove) { //marker if popover never placed before

            $(this).find('.popover')
                    .css({top : old_lowerRight.y, left : old_upperLeft.x})
                    .velocity({top : pos.y, left : pos.x}, 500, "swing");
        }
        else {
            d3.select(this).select(".popover").style("top", pos.y+"px").style("left", pos.x+"px");
        }
        d3.select(this).attr("placed","t");

    });

    d3.select("#popoverLines").selectAll("line.edge").each( function(d, i) {

        let source = new google.maps.LatLng(d.source.node_ref.data_src[d.source.node_ref.data_rows[0]][LATVAL],
                                            d.source.node_ref.data_src[d.source.node_ref.data_rows[0]][LONVAL]);
        let source2d = projection.fromLatLngToContainerPixel(source);

        //even if used a different corner in the past, mark old_ to whatever current corner is
        let old_targetX = d.target.popover_old_upperLeft.x + 3;
        let old_targetY = d.target.popover_old_upperLeft.y + 3;
        let targetX = d.target.popover_upperLeft.x + 3;
        if (Math.abs(source2d.x - d.target.popover_upperLeft.x - d.target.popover_width + 3) < Math.abs(source2d.x-targetX)) {
            targetX = d.target.popover_upperLeft.x + d.target.popover_width - 3;
            old_targetX = d.target.popover_old_upperLeft.x + d.target.popover_width - 3;
        }
        let targetY = d.target.popover_upperLeft.y + 3;
        if (Math.abs(source2d.y - d.target.popover_upperLeft.y - d.target.popover_height + 3) < Math.abs(source2d.y-targetY)) {
            targetY = d.target.popover_upperLeft.y + d.target.popover_height - 3;
            old_targetY = d.target.popover_old_upperLeft.y + d.target.popover_height - 3;
        }

        d3.select(this).attr("x1", source2d.x)
                       .attr("y1", source2d.y)
                       .style("stroke", d.target.color_string);

        if (animateMove) { //marker if popover never placed before
            $(this).attr({x2 : old_targetX, y2 : old_targetY})
                   .velocity({x2 : targetX, y2 : targetY}, 500, "swing");

        }
        else {
            d3.select(this).attr("x2", targetX)
                           .attr("y2", targetY);
        }



        d3.select(this).attr("placed","t")

    });




    //this.DEBUGupdatePopoverObjectsFromForce();

};


SVGOverlay.prototype.DEBUGupdatePopoverObjectsFromForce = function () {


    //use enter/exit to create and destroy popupwrappers and links
    var projection = this.getProjection();

    let pop = force_nodes.filter(function(d) {return d.type == "pop";});
        //console.log(pop);
    let leaf = force_nodes.filter(function(d) {return d.type == "leaf";});
    let bbox = force_nodes.filter(function(d) {return d.type == "bbox";});


    //hack to see if it works
    var svg = d3.select("#region_overlay");

    svg.selectAll("rect.pop").data(pop).enter().append("rect")
                .attr("class","pop")
                .attr("stroke", "#00f")
                .attr("fill","none")
                .attr("stroke-width", "1px");
    svg.selectAll("rect.pop").data(pop).exit().remove();
    svg.selectAll("rect.pop").each( function(d, i) {

        let latLng = new google.maps.LatLng(d.y,d.x);
        let upperLeft = projection.fromLatLngToContainerPixel(latLng);
        let heiWid = new google.maps.LatLng(d.y+d.height,d.x+d.width);
        let lowerRight = projection.fromLatLngToContainerPixel(heiWid);

                d3.select(this).attr("x", upperLeft.x)
                               .attr("y", lowerRight.y) //lowerright because we're dealing with neg vals
                               .attr("width", Math.abs(lowerRight.x - upperLeft.x))
                               .attr("height", Math.abs(lowerRight.y - upperLeft.y));
    });
    svg.selectAll("rect.leaf").data(leaf).enter().append("rect")
                .attr("class","leaf")
                .attr("stroke", "#0f0")
                .attr("fill","none")
                .attr("stroke-width", "1px");
    svg.selectAll("rect.leaf").data(leaf).exit().remove();
    svg.selectAll("rect.leaf").each( function(d, i) {

        let latLng = new google.maps.LatLng(d.y,d.x);
        let upperLeft = projection.fromLatLngToContainerPixel(latLng);
        let heiWid = new google.maps.LatLng(d.y+d.height,d.x+d.width);
        let lowerRight = projection.fromLatLngToContainerPixel(heiWid);

                d3.select(this).attr("x", upperLeft.x)
                               .attr("y", lowerRight.y)
                               .attr("width", Math.abs(lowerRight.x - upperLeft.x))
                               .attr("height", Math.abs(lowerRight.y - upperLeft.y));
    });
    svg.selectAll("rect.bbox").data(bbox).enter().append("rect")
                .attr("class","bbox")
                .attr("fill","none")
                .attr("stroke", "#f00")
                .attr("stroke-width", "1px");
    svg.selectAll("rect.bbox").data(bbox).exit().remove();
    svg.selectAll("rect.bbox").each( function(d, i) {

        let latLng = new google.maps.LatLng(d.y,d.x);
        let upperLeft = projection.fromLatLngToContainerPixel(latLng);
        let heiWid = new google.maps.LatLng(d.y+d.height,d.x+d.width);
        let lowerRight = projection.fromLatLngToContainerPixel(heiWid);

        d3.select(this).attr("x", upperLeft.x)
                       .attr("y", lowerRight.y)
                       .attr("width", Math.abs(lowerRight.x - upperLeft.x))
                       .attr("height", Math.abs(lowerRight.y - upperLeft.y));
    });
    svg.selectAll("line.edge").data(force_links).enter().append("line")
                .attr("class","edge")
                .attr("fill","none")
                .attr("stroke", "#f0f")
                .attr("stroke-width", "2px");
    svg.selectAll("line.edge").data(force_links).exit().remove();
    svg.selectAll("line.edge").each( function(d, i) {

        let latLng1 = new google.maps.LatLng(d.source.y,d.source.x);
        let s = projection.fromLatLngToContainerPixel(latLng1);
        let latLng2 = new google.maps.LatLng(d.target.y,d.target.x);
        let t = projection.fromLatLngToContainerPixel(latLng2);

        d3.select(this).attr("x1", s.x)
                       .attr("y1", s.y)
                       .attr("x2", t.x)
                       .attr("y2", t.y);
    });



};



SVGOverlay.prototype.forceTick = function () {
    //triggered every tick. converts from lat/lng into screenspace and updates position
    //this should take care of scrolling issues more gracefully
    this.updatePopoverObjectsFromForce(false, false);

};















//MARK -------------------------- RANKINGS




var SHOULD_SHOW_POPOVERS = false;
var LEAF_RANKINGS = [];
var SHOW_NODES = [];

//quickselect(leaves,i,0,leaves.length-1, function(a,b) { return a.rank-b.rank; });

var LAST_COMPUTED_TARGET = null;












//MARK ------------------------- SIDE BAR


var LAST_COMPUTED_TARGET = null;
SVGOverlay.prototype.updateSideBarWithLeaves = function (leafNodes, forceUpdate) {

    let oldLeaves = this.sideBarLeaves;

    this.sideBarLeaves = leafNodes;//.slice();
    this.sideBarLeaves.sort(function(a,b) {return a.rank-b.rank;});

    //check similarity
    if (oldLeaves && !forceUpdate) {
        let sameNodes = oldLeaves.length === leafNodes.length;
        if (sameNodes) {
            let i=oldLeaves.length-1;
            while (i>=0) {
                if (oldLeaves[i].id != leafNodes[i].id) {
                    sameNodes = false;
                    break;
                }
                i--;
            }
        }
        if (sameNodes) {
            return;
        }
    }
    //console.log(leafNodes.length);

    //store topmost node?

    let temp = this;
    $( ".recc-toggle" ).unbind('click').click(function() {return temp.toggleRecommendations();});

    //prime the sidebar with a few nodes

    $("#sidebar .rowPositioner").unbind("scroll");

    let startingPos = 0;
    let numToAdd = 5;
    let startOffset = Math.max(0, startingPos-3);
    let endOffset = Math.min(this.sideBarLeaves.length, startingPos+numToAdd+3);

    //scrolled call will fill stuff in

    $(".rowPositioner .padder").height( this.sideBarLeaves.length * 210 ); //210px tall
    $(".rowPositioner").scrollTop( startingPos * 210 );

    //set up the scroller
    this.sideBarScrolled();
    $("#sidebar .rowPositioner").scroll(function() {return temp.sideBarScrolled();});







};




SVGOverlay.prototype.rowElementForLeafNode = function (index, leafNode) {


    let row = leafNode.data_rows[0];
    let name = leafNode.data_src[row]['name'].trim();
    let neighborhood = leafNode.data_src[row]['neighborhood'];
    let categories = leafNode.data_src[row]['categories'];
    let rating = leafNode.data_src[row]['rating'];
    let ratingImg = rating.toFixed(1) + '.png';
    let url = leafNode.data_src[row]['url'];
    let highlights = leafNode.data_src[row]['highlights'];
    let num_reviews = leafNode.data_src[row]['num_reviews'];
    let images = leafNode.data_src[row]['images'];
    let price = leafNode.data_src[row]['price'];

    let rowContainer = $("<div>").addClass("row")
                             .attr("nid", leafNode.id)
                             .attr("i", index)
                             .css("top", index * 210+"px");


    let header = $("<div>").addClass("header");
        header.append( $("<div>").addClass("rank").text(leafNode.rank));
        header.append( $("<div>").addClass("title").append( $("<a>")
                                    .attr("href",url)
                                    .attr("target","_blank")
                                    .text(name) ) );
        header.append( $("<div>").addClass("tagline").append($("<span>").text(explainLeaf(leafNode)) ) );

    let details = $("<div>").addClass("details");
        details.append( $("<div>").addClass("top")
               .append( $("<span>").addClass("rating")
                    .append($("<img>").attr("src",ratingImg) ) ) );
    details.children(".top").append( $("<span>").addClass("price spacer-before").text(price) );
    if (neighborhood.length > 0) {
        details.children(".top").append( $("<span>").addClass("neighborhood spacer-before").text(neighborhood) );
    }
    let b = $("<div>").addClass("bot") ;
    details.append(b);
    let i = 0;
    while (i<categories.length-1) {
        let cat = categories[i];
        b.append( $("<span>").addClass("spacer-after no-overflow").text(cat) );
        i++;
    }
    b.append( $("<span>").addClass("no-overflow").text(categories[categories.length-1]) );



    let imageSlider = $("<div>").addClass("imageContainer");
    let imagesList = $("<ul>").attr("id","imageList");
    i=0;
    while (i<images.length) {
        imagesList.append($('<li>')
                            .append($('<div>')
                            .addClass('imageWrapper')
                                .append($("<img>")
                                .attr("src",images[i])
                                .attr("width", "72px"))));
        i++;
    }
    imageSlider.append(imagesList);

    imagesList.lightSlider({
        item: 1,
        autoWidth: true,
        slideMove: 1, // slidemove will be 1 if loop is true
        slideMargin: -9,
        gallery: false,
        pager: false,
        loop:false,
    });




    rowContainer.append(header);
    rowContainer.append(details);
    rowContainer.append(imageSlider);


    return rowContainer;

};




SVGOverlay.prototype.toggleRecommendations = function () {

    SHOULD_SHOW_POPOVERS = !SHOULD_SHOW_POPOVERS;
    $( "#show_reccs" ).prop( "checked", SHOULD_SHOW_POPOVERS );

    if (SHOULD_SHOW_POPOVERS) {
        this.sideBarScrolled(this.sideBarLeaves);
    }
    else {
        SHOW_NODES = [];
    }
    this.updateRecommendedPopovers();

}

var DELOAD_SPACING = 800; // this should be bigger than any row ought to be but not as big as 2 rows
var RELOAD_SPACING = 500;

var PRELOAD_PADDING = 300;
var minScrollTime = 50;
var scrollTimer, lastScrollFireTime = 0;
var now = new Date().getTime();
SVGOverlay.prototype.sideBarScrolled = function () {

    //throttle scroll events a bit
    let temp = this;
    //function processScroll() {

        let viewHeight = $(".rowPositioner").height();
        let scrolltop = $(".rowPositioner").scrollTop();
        let padder = $("#sidebar .rows .padder");

        let topIndex = Math.max(0, Math.floor((scrolltop - PRELOAD_PADDING) / 210.0));
        let botIndex = Math.min(temp.sideBarLeaves.length, Math.ceil((scrolltop + viewHeight + PRELOAD_PADDING) / 210.0));

        let rows = $("#sidebar .rows");


        //do this in a strange way because it ought to be faster to iterate
        rows.children(".row").each( function() {

            let i = $(this).attr("i");
            if (i < topIndex || i >= botIndex) {
                $(this).remove();
            }

        });

        SHOW_NODES = [];
        for (let i=topIndex; i<botIndex; i++) {

            let e = rows.children(".row[i="+i+"]");
            if (!e.length) { //if it's a new node, build it

                e = temp.rowElementForLeafNode(i, temp.sideBarLeaves[i]);
                let target = rows.children(".row[i="+(i-1)+"]");

                if (!target.length) {
                    padder.after(e);
                }
                else {
                    target.after(e);
                }

                e.mouseenter(temp.mouseEnterRow);
                e.mouseleave(temp.mouseLeaveRow);
            }
            else { //if it already exists, verify it hasn't changed
                if (e.attr("nid") != temp.sideBarLeaves[i].id) {
                    e.replaceWith(temp.rowElementForLeafNode(i, temp.sideBarLeaves[i]));
                }
            }

            let top=e.offset().top;
            let height=e.height();
            if (top + (height/2.0) > 0 && top < viewHeight) {
                SHOW_NODES.push(temp.sideBarLeaves[i]);
            }

        }


        temp.updateRecommendedPopovers();


        /*
    }

    //simple throttle
    if (new Date().getTime() - now > 10)
    {
        now = new Date().getTime();
        processScroll();
    } */







};

var N_RECOMMENDATIONS = 5;
SVGOverlay.prototype.updateRecommendedPopovers = function () {

    if (!SHOULD_SHOW_POPOVERS) {
        SHOW_NODES = [];
    }

    //poll for visibility on sidebar, take the top N

    /*
    let  l =[]
    for (let n of LEAVES_ONSCREEN) {
        l.push(n.data_src[n.data_rows[0]]['name'])
    }
    console.log(l);

    console.log(SHOW_NODES);
    l =[]
    for (let n of SHOW_NODES) {
        l.push(n.data_src[n.data_rows[0]]['name'])
    }
    console.log(l)*/

    //recommended circle highlight

    //this.refreshPopoversForNodes(recommended, bounds, viewSize, viewSizeChanged);

    let changeFound = false;
    let pop_ids = {};
    for (let pop of this.popoverNodes) {
        pop_ids[pop.id] = 1;
    }
    let sh_ids = {};
    for (let sh of SHOW_NODES) {
        sh_ids[sh.id] = 1;
        if (!(sh.id in pop_ids)) {
            changeFound = true;
            this.addPopoverToSimulation(sh);
        }
    }
    let i=this.popoverNodes.length-1;
    while(i>=0) {
        let pop = this.popoverNodes[i];
        if (!(pop.id in sh_ids)) {
            changeFound = true;
            this.removePopoverFromSimulation(pop);
        }
        i--;
    }

    if (changeFound) {
        this.iterateForceAndUpdatePopups(false);
    }

    this.drawRecommended(force_nodes, this.map.getBounds());
    //MODIFY THE FORCE MODEL AS NEED BE

}



SVGOverlay.prototype.mouseEnterRow = function () {

//make a fancy callout circle to overwrite canvas node
//bold recommended popover if present

    let row = NODEID_TO_NODE[parseInt($(this).attr("nid"))].data_rows[0];
    let circle = datarowToCircle[row];
    if (circle.htmlnode) {
        let node = $(circle.htmlnode);
        /*node.attr("old_stroke",node.attr("stroke"))
            .attr("old_width",node.attr("stroke-width"))
            .attr("stroke-width","3px")
            .attr("stroke","#000");*/

        let anim = d3.select("#animation_overlay").append("circle").node();
        $(anim).attr("cx",node.attr("cx"))
                .attr("cy",node.attr("cy"))
                .attr("r",parseInt(node.attr("r"))+10)
                .css("fill","none")
                .css("stroke-width","4px")
                .css("stroke", "#eb4f02")
                .css("opacity", 1)
                .velocity({
                    "opacity" : 0,
                    "r": 30,
                }, {duration: 2000,
                    easing: "ease-in",
                    complete: function() {$(this).remove();}
                });

    }

};

SVGOverlay.prototype.mouseLeaveRow = function () {

    //hide callout circle

    /*
    console.log(this);
    let row = NODEID_TO_NODE[parseInt($(this).attr("nid"))].data_rows[0];
    let circle = datarowToCircle[row];

    if (circle.htmlnode) {
        let node = $(circle.htmlnode);
        node.attr("stroke-width",node.attr("old_width"))
            .attr("stroke",node.attr("old_stroke-width"))
            .removeAttr("old_stroke")
            .removeAttr("old_width");
    }*/


};











//arcx

//--------------------------- FILTER WEIGHT SIDEBAR -----------------------

class UserWeight {

    constructor(ident, name, sortOrder, weightFunction) {
        this.id = ident;
        this.name = name;
        this.isActive = false;
        this.weightFunction = weightFunction.bind(this);
                //function takes in [rows] and outputs {weight, color, scale, opaque, explanation}
                //params can be missing from dict, but weight must be there
                //-1 in color or size means they are discarded in calc
        this.scalar = 1; //modifier to apply to weight later on -- user confidence metric
        this.sortOrder = sortOrder; //0--lifestyle, 1--numeric, 2--nominative
        this.booleanFilter = false;
        this.needsNomColor = false;
        this.needsLegend = false;
        this.bgColor = null;

        this.explanationsuffix = "restaurant";
        this.intensityterms = ['not very', 'somewhat', '', "very"];
    }

}

var DEFAULT_COLOR_SCALE = d3.interpolateViridis;
var AVAILABLE_COLORS = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f",
"#bcbd22", "#17becf", "#aec7e8", "#ffbb78", "#98df8a", "#ff9896", "#c5b0d5", "#c49c94", "#f7b6d2", "#c7c7c7",
 "#dbdb8d", "#9edae5"]
 AVAILABLE_COLORS.reverse(); //reverse so we can push/pop in peace

var activeWeights = [];
var fallbackWeight = new UserWeight(-1, "default", -1, function(rows) {
    return {weight: 1,
            opaque: true,
            color: DESC_STATS['rating'].scale(DATASET[rows[0]]['rating']),
            size: DESC_STATS.log_num_reviews.scale(Math.log(DATASET[rows[0]].num_reviews))
        };
});
var nullWeight = new UserWeight(-195, "nullweight", -2, function(rows) {
    return {weight: 1,
            opaque: false,
            color: -1,
            size: -1};
});
var weightList = [];
var weightIDtoWeight = {};


function populateWeights() {

    let wID = 0;
    //all the weights we have

    let w = new UserWeight(wID, "Highly rated", 1, function(rows) {
        let max = -1;
        let i=rows.length-1;
        while(i>=0) {
            let v = DESC_STATS['rating'].scale(parseFloat(DATASET[rows[i]]['rating']));
            if (v > max) { max = v; }
            i--;
        }
        return {weight: max,
                color: max,
                size: max};
    });
    w.explanationsuffix = "highly rated"
    weightList.push(w);
    weightIDtoWeight[wID] = w;
    wID++;
    w = new UserWeight(wID, "Popular", 1, function(rows) {
        let max = -1;
        let i=rows.length-1;
        while(i>=0) {
            let v = DESC_STATS.log_num_reviews.scale(Math.log(DATASET[rows[0]].num_reviews));
            if (v > max) { max = v; }
            i--;
        }
        return {weight: max,
                color: max,
                size: max};
    });
    w.explanationsuffix = "popular"
    weightList.push(w);
    weightIDtoWeight[wID] = w;
    wID++;
    w = new UserWeight(wID, "Rarely reviewed", 1, function(rows) {
        let min = 2;
        let i=rows.length-1;
        while(i>=0) {
            let v = DESC_STATS.log_num_reviews.scale(Math.log(DATASET[rows[0]].num_reviews));
            if (v < min) { min = v; }
            i--;
        }
        return {weight: 1 - min,
                color: 1 - min,
                size: 1 - min};
    });
    w.explanationsuffix = "rarely reviewed"
    weightList.push(w);
    weightIDtoWeight[wID] = w;
    wID++;
    w = new UserWeight(wID, "Inexpensive", 1, function(rows) {
        let min = 2;
        let i=rows.length-1;
        while(i>=0) {
            let v = DESC_STATS['price_numeric'].scale(parseFloat(DATASET[rows[i]]['price_numeric']));
            if (v < min) { min = v; }
            i--;
        }
        return {weight: 1 - min,
                color: 1 - min,
                size: 1 - min};
    });
    w.explanationsuffix = "inexpensive"
    weightList.push(w);
    weightIDtoWeight[wID] = w;
    wID++;
    w = new UserWeight(wID, "Fancy", 1, function(rows) {
        let max = -1;
        let i=rows.length-1;
        while(i>=0) {
            let v = DESC_STATS['price_numeric'].scale(parseFloat(DATASET[rows[i]]['price_numeric']));
            if (v > max) { max = v; }
            i--;
        }
        return {weight: max,
                color: max,
                size: max};
    });
    w.explanationsuffix = "fancy"
    weightList.push(w);
    weightIDtoWeight[wID] = w;
    wID++;
    w = new UserWeight(wID, "Have bars nearby", 0, function(rows) {
        let v = NEARBY_STATS.categories.counts[rows[0]]['Bars'];
        if (v) {
            let vn = NEARBY_STATS.categories.scales['Bars'](v);
            return {weight: vn,
                    color: vn,
                    size: vn,
                    opaque: true};
        }
        else {
            return {weight: 0,
                    color: -1,
                    size: -1,
                    opaque: false};
        }
    });
    w.explanationsuffix = "bars nearby";
    w.intensityterms = ['not many', 'a few', '', "lots of"];
    weightList.push(w);
    weightIDtoWeight[wID] = w;
    wID++;
    w = new UserWeight(wID, "Have dessert nearby", 0, function(rows) {
        let v = NEARBY_STATS.categories.counts[rows[0]]['Desserts'];
        if (v) {
            let vn = NEARBY_STATS.categories.scales['Desserts'](v);
            return {weight: vn,
                    color: vn,
                    size: vn,
                    opaque: true};
        }
        else {
            return {weight: 0,
                    color: -1,
                    size: -1,
                    opaque: false};
        }
    });
    w.explanationsuffix = "dessert places nearby";
    w.intensityterms = ['not many', 'a few', '', "lots of"];
    weightList.push(w);
    weightIDtoWeight[wID] = w;
    wID++;
    w = new UserWeight(wID, "Have cafés nearby", 0, function(rows) {
        let v = NEARBY_STATS.categories.counts[rows[0]]['Cafes'];
        if (v) {
            let vn = NEARBY_STATS.categories.scales['Cafes'](v);
            return {weight: vn,
                    color: vn,
                    size: vn,
                    opaque: true};
        }
        else {
            return {weight: 0,
                    color: -1,
                    size: -1,
                    opaque: false};
        }
    });
    w.explanationsuffix = "cafés nearby";
    w.intensityterms = ['not many', 'a few', '', "lots of"];
    weightList.push(w);
    weightIDtoWeight[wID] = w;
    wID++;

    //unusual cuisines
    //best in area
    //rising stars?


    //do something more complex with genres

    let cats = [];
    for (let cat in DESC_STATS.categories.count) { cats.push(cat); }
    cats.sort();

    let CUTOFF = 3;
    for (let cat of cats) {
        if (DESC_STATS.categories.count[cat] < CUTOFF) {
            continue;
        }

        w = new UserWeight(wID, cat, 2, function(rows) {
            let found = false;
            let i=rows.length-1;
            while(i>=0) {
                let y = DATASET[rows[i]]['categories'].length-1;
                while (y>=0) {
                    if (DATASET[rows[i]]['categories'][y] === cat) {
                        found = true;
                        break;
                    }
                    y--;
                }
                i--;
            }

            if (found) {
                return {weight: 1,
                        nomColor: this.bgColor,
                        color: -1,
                        size: -1,
                        opaque: true};
            }
            else {
                return {weight: 0,
                        color: -1,
                        size: -1,
                        opaque: false};
            }
        });
        w.needsNomColor = true; //IMPORTANT!
        w.needsLegend = true;
        weightList.push(w);
        weightIDtoWeight[wID] = w;
        wID++;

    }

    //default actives
    //activeWeights = [ weightIDtoWeight[0], weightIDtoWeight[1] ];

}



/*
    */


function buildWeightRows() {



    let $rows = $("#filterList");
    for (let w of weightList) {

        //applied
        let row = $("<div>").addClass("filterRow").attr("wID",w.id);
        row.append( $("<div>").addClass("label").text(w.name) );
        row.append( $("<div>").addClass("addRemove")
           .append( $("<input>").attr("type","checkbox")
                                .attr("name","Add/Remove Row")
                                .prop("colorSample", w.label_color != null)
                                .addClass("arButton")) );

                                if (w.needsNomColor) {
                                    //maybe we actually create and assign the label color here...
                                    row.append( $("<div>").addClass("colorSample").css("background-color", w.label_color) );
                                }

        $rows.append(row);
    }
    for (let w of weightList) {
        let row = $rows.find(".filterRow[wID='"+w.id+"']");

        //defaults set
        let active = false;
        for (let aw of activeWeights) {
            if (aw.id === w.id) { active = true; break; }
        }
        if (active) {
            row.find("input").prop("checked", true);
            row.addClass("applied");
            if (w.bgColor) {
                //do a better bg color and verify text color
                row.css("background-color",w.bgColor);
            }
            //move up to the top
            //row.after( $("<div>").addClass("marker").attr("i", row.attr("wID")) );
            //row.parent().find(".titleRow").after(row);
        }
    }

    $("input.arButton").switchButton({
        //labels_placement: "right",
        show_labels: false,
        height: 16,
        button_width: 16,
        width: 32,
    });

    $("input.arButton").change(function(){
        let $row = $(this).closest(".filterRow");
        let w = weightIDtoWeight[parseInt( $row.attr("wID") )];
        if (this.checked) {
            $row.addClass("applied");
            if (w.bgColor) {
                //do a better bg color and verify text color
                $row.css("background-color",w.bgColor);
            }
            activeWeights.push(w);

            //move up to the top
            /*setTimeout(function() {
                $row.after( $("<div>").addClass("marker").attr("i", $row.attr("wID")) );
                $row.parent().find(".titleRow").after($row);
            }, 800);*/
        }
        else {
            $row.removeClass("applied");
            $row.css("background-color","");
            var index = $.inArray(w, activeWeights); //delete it from active
            if (index >= 0) { activeWeights.splice(index, 1); }

            //move back to position
            /*setTimeout(function() {
                $(".marker[i='"+$row.attr("wID")+"']").delay(600).replaceWith($row);
            }, 800);*/
        }
        //trigger update of class applications

        updateLegend();

        TEMPORARY_MOUSEOVER_WEIGHT = null;
        filterListScrolled(); //update the rows scrolled in case we freed up color
        updateInterfaceForActiveWeights();
        //OVERLAY.updateSVGCirclesOnScreen();
    });





    //mouseenter
    $(".filterRow").mouseenter(function() {
        let w = weightIDtoWeight[parseInt($(this).attr("wID"))];

        if (w.weightFunction && !$(this).hasClass("applied")) {
            TEMPORARY_MOUSEOVER_WEIGHT = w;
            applyActiveWeightsTo(allCircles);
            OVERLAY.updateSVGCirclesOnScreen();
            //OVERLAY.temporarilyRecolorSVGCircles(w.weightFunction);
        }

    });

    $(".filterRow").mouseleave(function() {
        //OVERLAY.temporarilyRecolorSVGCircles(function() {return {color: "#fff", opaque: false};});
        TEMPORARY_MOUSEOVER_WEIGHT = null;
        applyActiveWeightsTo(allCircles);
        OVERLAY.updateSVGCirclesOnScreen();
    });

    //mouseleave

    //on scrolling, assign BG colors to the rows onscreen that need them
    filterListScrolled();
    $("#filterContainer").scroll(filterListScrolled);

    updateLegend();
}


function updateLegend() {

    $("#filterConfig .legendRow").remove();
    for (let w of activeWeights) {
        if (w.needsLegend) {
            let $row = $("<div>").addClass("legendRow");
            $row.append( $("<div>").addClass("sample").css("background-color",w.bgColor) );
            $row.append( $("<div>").addClass("label").text(w.name) );
            $("#filterConfig .colorRow").before($row);
        }
    }

}



function filterListScrolled() {


    //update tag colors
    $(".filterRow").each(function() {

        let w = weightIDtoWeight[parseInt($(this).attr("wID"))];
        if (!w.needsNomColor || $(this).hasClass("applied")) {
            return;
        }



        let viewHeight = $("#filterContainer").height();
        let scrolltop = $("#filterContainer").scrollTop();
        let onScreen = $(this).offset().top+$(this).height() >= -10 &&
                       $(this).offset().top+$(this).height() <= viewHeight+40;

        if (onScreen) {

            if (w.bgColor == null) {
                let freeColor;
                if (AVAILABLE_COLORS.length < 1) {
                    freeColor = Please.make_color({
                                    golden: false, //disable default
                                    full_random: true //go full random
                                });
                }
                else {
                    freeColor = AVAILABLE_COLORS.pop();
                }
                w.bgColor = freeColor;
                $(this).find(".colorSample").css("background-color",w.bgColor);
            }

        }
        else {
            if (w.bgColor) {
                AVAILABLE_COLORS.push(w.bgColor);
                w.bgColor = null;
            }
            $(this).find(".colorSample").css("background-color","");
        }

    });


}




//WE USE THE AVERAGE OF WEIGHTED VALUES RATHER THAN THE


function updateInterfaceForActiveWeights() {

    let visibleCircles = applyActiveWeightsTo(allCircles);

    updateLeafRankings();

    /*
    let leaves = [];
    let i=visibleCircles.length-1;
    while (i>=0) {
        for (let row of visibleCircles[i].data_rows) {
            leaves.push(LEAFROW_TO_NODE[row]);
        }
        i--;
    }
    console.log(leaves);*/


    OVERLAY.updateSideBarWithLeaves(LEAVES_ONSCREEN, true);

    OVERLAY.resetSimulation();

}



var TEMPORARY_MOUSEOVER_WEIGHT = null;
function applyActiveWeightsTo(circles) {

    let foundColor = false;
    let foundSize = false;
    let minC = Number.MAX_VALUE;
    let maxC = -Number.MAX_VALUE;
    let minR = Number.MAX_VALUE;
    let maxR = -Number.MAX_VALUE;


    let i=circles.length-1;
    while (i>=0) {

        let circle = circles[i];

        /*
        if (TEMPORARY_MOUSEOVER_WEIGHT) {
            let wf = TEMPORARY_MOUSEOVER_WEIGHT.weightFunction(circle.data_rows);
            if (TEMPORARY_MOUSEOVER_WEIGHT.needsNomColor) {
                if (wf.nomColor) {
                    circle.color = wf.nomColor;
                }
                else {
                    circle.color = "#fff";
                }
            }
            //else {
            //    circle.color = DEFAULT_COLOR_SCALE(wf.color);
            //}

            //circle.r = circle.r;
            if (wf.opaque == null) {
                circle.opacity = 1;
            }
            else {
                circle.opacity = 0.4 + wf.opaque*0.6;
            }
        }*/
        if (activeWeights.length === 0 && TEMPORARY_MOUSEOVER_WEIGHT == null) {
            /*let wf = fallbackWeight.weightFunction(circle.data_rows);
            circle.color = DEFAULT_COLOR_SCALE(wf.color);
            circle.r = wf.size * 5 + 1;
            if (wf.opaque == null) {
                circle.opacity = 1;
            }
            else {
                circle.opacity = 0.4 + wf.opaque*0.6;
            }*/
            circle.color = "rgb(136, 194, 232)";
            circle.r = 4;
            circle.opaque = true;
            circle.opacity = 1;

        }
        else {
            let j=activeWeights.length-1;
            let avgR = 0;
            let nR = 0;
            let avgC = 0;
            let nC = 0;
            let hasNomColor = false;
            let nomColors = {};
            let foundOpaque = false;
            let opaque = false;
            while (j>=0) {
                let w = activeWeights[j];
                let wf = w.weightFunction(circle.data_rows);

                if (wf.size >= 0){
                    avgR = avgR + wf.size;
                    nR++;
                }

                if (w.needsNomColor && wf.nomColor) {
                    hasNomColor = true;
                    if (!(wf.nomColor in nomColors)) {
                        nomColors[wf.nomColor] = 0;
                    }
                    nomColors[wf.nomColor] = nomColors[wf.nomColor] + 1;
                }
                else if (wf.color >= 0) {
                    avgC = avgC + wf.color;
                    nC++;
                }

                if (wf.opaque != null) {
                    foundOpaque=true;
                    opaque = opaque || wf.opaque;
                }

                j--;
            }
            //also factor in the new mouseover
            if (TEMPORARY_MOUSEOVER_WEIGHT) {
                let wf = TEMPORARY_MOUSEOVER_WEIGHT.weightFunction(circle.data_rows);

                //ignore size
                /*
                if (wf.size >= 0){
                    avgR = avgR + wf.size;
                    nR++;
                }*/

                if (TEMPORARY_MOUSEOVER_WEIGHT.needsNomColor && wf.nomColor) {
                    hasNomColor = true;
                    if (!(wf.nomColor in nomColors)) {
                        nomColors[wf.nomColor] = 0;
                    }
                    nomColors[wf.nomColor] = nomColors[wf.nomColor] + 1;
                }
                else if (wf.color >= 0) {
                    avgC = avgC + wf.color;
                    nC++;
                }

                if (wf.opaque != null) {
                    foundOpaque=true;
                    opaque = opaque || wf.opaque;
                }
            }


            let colorVal = avgC / Math.max(nC, 1);
            if (hasNomColor) {

                let c = null;
                let t = -1;
                for (let color in nomColors) {
                    if (nomColors[color] > t) { c = color; t = nomColors[color]; }
                }
                circle.color = c;
                if (nC > 0) {
                    let v = avgC / nC;
                    minC = Math.min(v, minC);
                    maxC = Math.max(v, maxC);
                    foundColor = true;
                }
                circle.nom = true;
            }
            else if (nC === 0) {
                circle.color = "rgb(136, 194, 232)";
                circle.nom = true;
            }
            else {
                let v = avgC / nC;
                minC = Math.min(v, minC);
                maxC = Math.max(v, maxC);
                circle.color = v;
                foundColor = true;
                circle.nom = false;
            }

            if (nR === 0) {
                circle.r = -1;
            }
            else {
                let v = avgR / nR;
                circle.r = v;
                minR = Math.min(v, minR);
                maxR = Math.max(v, maxR);
                foundSize = true;
            }

            if (foundOpaque)  {
                circle.opacity = 0.2 + 0.6*opaque;
                circle.opaque=opaque;
            }
            else {
                circle.opacity = 0.8;
                circle.opaque = true;
            }


        }


        i--;
    }

    //use ranges to normalize the sizes/colors
    let visibleCircles = [];
    i=circles.length-1;
    while (i>=0) {
        let circle = circles[i];

        if (foundColor && !circle.nom && maxC > minC) {
            circle.color = DEFAULT_COLOR_SCALE( (circle.color - minC) / (maxC-minC) );
        }
        else if (foundColor && !circle.nom && maxC === minC) {
            circle.color = DEFAULT_COLOR_SCALE( 0.5 );
        }

        if (foundSize && circle.r >= 0 && maxR > minR) {
            circle.r = ((circle.r - minR) / (maxR-minR)) * 4 + 2;
        }
        else {
            circle.r = 4;
        }

        if (circle.opaque) {
            visibleCircles.push(circle);
        }

        i--;
    }


    return visibleCircles;



}


















//MARK --------------------POPOVER DRAW




SVGOverlay.prototype.buildPopover = function ( node, projection, containerElement, expandable ) {

    //determine if we have a leaf node or a group of rows
    if (node.data_rows.length === 0) {
        return null;
    }
    else if (node.data_rows.length === 1) {
        return this.fillNotePopover(node, projection, containerElement, expandable);
    }
    else {
        return this.fillGroupPopover(node, projection, containerElement, expandable);
    }

};


SVGOverlay.prototype.fillNotePopover = function( node, projection, wrapperElement, expandable ) {

    let containerElement = d3.select(wrapperElement)
                    .attr("node_id", node.id)
                    .attr("class", "popover-wrapper")
                    .append("div");
    containerElement.attr("class", "popover note-popover");

    let infobox = containerElement.append("div").attr("class", "infobox");

    let row = node.data_rows[0];

    let name = node.data_src[row]['name'].trim();
    let neighborhood = node.data_src[row]['neighborhood'];
    let categories = node.data_src[row]['categories'];
    let rating = node.data_src[row]['rating'];
    let ratingImg = rating.toFixed(1) + '.png';
    let url = node.data_src[row]['url'];
    let highlights = node.data_src[row]['highlights'];
    let num_reviews = node.data_src[row]['num_reviews'];
    let images = node.data_src[row]['images'];
    let price = node.data_src[row]['price'];

    //small box starts here
    let headerContainer = infobox.append("div");
    headerContainer.attr("class", "header");

    headerContainer.append("div").attr("class", "title");
    headerContainer.select('.title').append("span")
        .attr("class","name no-overflow")
        .text(name);


    headerContainer.append("div").attr("class", "ratings");
    headerContainer.select('.ratings').append("span").attr("class","rank").text('#'+node.rank);
    headerContainer.select('.ratings').append("span").append("img")
        .attr("src", ratingImg);

    headerContainer.append("div").attr("class", "explanation");
    headerContainer.select('.explanation').append("span").text(explainLeaf(node));

    //small box ends here

    //s
    //only add details expand if there is enough stuff to show

    //expanding stuff


    let $popoverContainer = $(containerElement.node());


    let contentContainer = containerElement.append("div").attr("class", "expandableContent");
    let snippetsLabel = contentContainer.append("div").attr("class", "expandLabel");

    let snippetsContainer = contentContainer.append("div").attr("class", "snippetsWrapper");
    let snippetsDrawer = snippetsContainer.append("div").attr("class","snippetsDrawer");

    //populate the snippets



    let imagesContainer = snippetsDrawer.append("div")
                                    .attr("class", "imageContainer");
    let imagesList = imagesContainer.append("ul");



    imagesList.attr("id", "imageList");
    let i=0;
    while (i<images.length) {
        imagesList.append('li')
                       .append('div')
                       .attr('class','imageWrapper')
                       .append("img")
                       .attr("src",images[i])
                       .attr("width", "110px");
        i++;
    }


    $(imagesList.node()).lightSlider({
        item: 1,
        autoWidth: true,
        slideMove: 1, // slidemove will be 1 if loop is true
        slideMargin: 5,
        gallery: false,
        pager: false,
        loop:false,
    });


    let rightContent = snippetsDrawer.append("div").attr("class", "rightContent");

    rightContent.append("div").attr("class", "details");
    rightContent.select('.details').append("a")
        .attr("class", "yelplink")
        .attr("href", url)
        .attr("target","_blank")
        .text('[Yelp page]');

    rightContent.select('.details').append("span")
        .attr("class", "price spacer-after")
        .text(price);

    rightContent.select('.ratings').append("span")
        .text(num_reviews + " reviews");

    i = 0;
    while (i<categories.length-1) {
        let cat = categories[i];
        rightContent.select('.details').append("span")
            .attr("class", "spacer-after no-overflow")
            .text(cat);
        i++;
    }
    rightContent.select('.details').append("span")
        //no spacer for final category!
        .attr("class", "no-overflow")
        .text(categories[categories.length-1]);






    //highlights

    let list = rightContent.append("div").attr("class","snippets").append("ul");
    i = 0;
    while (i < highlights.length) {
        list.append("li").text(highlights[i]);
        i++;
    }

    let $snip = $(snippetsDrawer.node()).show();
    let $label = $(snippetsLabel.node()).text("+");
    let $imgContainer = $(imagesContainer.node());
    $snip.css("margin-top", -1 * $snip.height());
    $snip.css("margin-left", -1 * $snip.width());
    //drawer anim
    $(snippetsLabel.node()).click(function () {
        //console.log(parseInt($snip.css("margin-top")));
        if (parseInt($snip.css("margin-top")) < -1) {
            $label.text("-");
            $popoverContainer.css("z-index", 2000);

            //shift the whole container up if we would go below bottom of screen
            let offsetX = $('#mapSVG').innerWidth() - $popoverContainer.position().left
                                               - $(headerContainer.node()).width()
                                               - $snip.outerWidth()
                                               - 15; //pad
            let offsetY = $('#mapSVG').innerHeight() - $popoverContainer.position().top
                                                - $(headerContainer.node()).height()
                                                - $snip.outerHeight()
                                                - $label.outerHeight()
                                                - 15; //pad;

            if (offsetX < 0 || offsetY < 0) {
                offsetX = Math.min(offsetX,0);
                offsetY = Math.min(offsetY,0);
                $popoverContainer.attr("offset_x", offsetX);
                $popoverContainer.attr("offset_y", offsetY);
                $popoverContainer.velocity({ 'left' : $popoverContainer.position().left + offsetX,
                                            'top' : $popoverContainer.position().top + offsetY }, 500, "swing");
            }


            $snip.velocity({
                "margin-top" : 0,
                "margin-left" : 0
            }, 500, "swing");


        }
        else {
            $label.text("+");
            $snip.velocity({
                "margin-top" : -1 * $(contentContainer.node()).height(),
                "margin-left" : -1 * $(contentContainer.node()).width()
            }, 500, "swing");
            $popoverContainer.css("z-index", 999);

            let offsetX = $popoverContainer.attr("offset_x");
            let offsetY = $popoverContainer.attr("offset_y");
            if (offsetX < 0 || offsetY < 0) {
                $popoverContainer.attr("offset_x", 0);
                $popoverContainer.attr("offset_y", 0);
                offsetX = Math.min(offsetX,0);
                offsetY = Math.min(offsetY,0);
                $popoverContainer.velocity({ 'left' : $popoverContainer.position().left - offsetX,
                                            'top' : $popoverContainer.position().top - offsetY }, 500, "swing");
            }
        }
    });




};


SVGOverlay.prototype.updateNotePopoverContent = function( node, wrapperElement ) {

    if (parseInt(d3.select(wrapperElement).attr("c_id")) === node.id) {
        return;
    }
    d3.select(wrapperElement).attr("c_id",node.id);


    let row = node.data_rows[0];

    let name = node.data_src[row]['name'].trim();
    let neighborhood = node.data_src[row]['neighborhood'];
    let categories = node.data_src[row]['categories'];
    let rating = node.data_src[row]['rating'];
    let ratingImg = rating.toFixed(1) + '.png';
    let url = node.data_src[row]['url'];
    let highlights = node.data_src[row]['highlights'];
    let num_reviews = node.data_src[row]['num_reviews'];
    let images = node.data_src[row]['images'];
    let price = node.data_src[row]['price'];

    //small box starts here

    let containerElement = d3.select(wrapperElement).select('.popover');
    let infobox = containerElement.select(".infobox");
    let headerContainer = infobox.select(".header");
    headerContainer.select("span.name").text(name);
    headerContainer.select("span.ratings").text(rating+" stars");
    headerContainer.select('.ratings .rank').text('#'+node.rank);
    headerContainer.select('div.ratings img').attr("src", ratingImg);
    headerContainer.select('.explanation span').text(explainLeaf(node));

    let $popoverContainer = $(containerElement.node());
    let contentContainer = containerElement.select(".expandableContent");
    let snippetsLabel = contentContainer.select(".expandLabel");
    let snippetsContainer = contentContainer.select(".snippetsWrapper");

    //EMPTY AND REBUILD THE IMAGE CONTAINER
    let snippetsDrawer = snippetsContainer.select(".snippetsDrawer").html("");
    let imagesContainer = snippetsDrawer.append("div")
                                    .attr("class", "imageContainer");
    let imagesList = imagesContainer.append("ul");

    imagesList.attr("id", "imageList");
    let i=0;
    while (i<images.length) {
        imagesList.append('li')
                       .append('div')
                       .attr('class','imageWrapper')
                       .append("img")
                       .attr("src",images[i])
                       .attr("width", "110px");
        i++;
    }
    $(imagesList.node()).lightSlider({
        item: 1,
        autoWidth: true,
        slideMove: 1, // slidemove will be 1 if loop is true
        slideMargin: 5,
        gallery: false,
        pager: false,
        loop:false,
    });

    //empty out and refill

    let rightContent = snippetsDrawer.append("div").attr("class", "rightContent");
    rightContent.append("div").attr("class", "details");
    rightContent.select('.details').append("a")
        .attr("class", "yelplink")
        .attr("href", url)
        .attr("target","_blank")
        .text('[Yelp page]');
    rightContent.select('.details').append("span")
        .attr("class", "price spacer-after")
        .text(price);
    rightContent.select('.ratings').append("span")
        .text(num_reviews + " reviews");

    i = 0;
    while (i<categories.length-1) {
        let cat = categories[i];
        rightContent.select('.details').append("span")
            .attr("class", "spacer-after no-overflow")
            .text(cat);
        i++;
    }
    rightContent.select('.details').append("span")
        //no spacer for final category!
        .attr("class", "no-overflow")
        .text(categories[categories.length-1]);

    //highlights
    let list = rightContent.append("div").attr("class","snippets").append("ul");
    i = 0;
    while (i < highlights.length) {
        list.append("li").text(highlights[i]);
        i++;
    }

    let $snip = $(snippetsDrawer.node()).show();
    let $label = $(snippetsLabel.node()).text("+");
    let $imgContainer = $(imagesContainer.node());
    $snip.css("margin-top", -1 * $snip.height());
    $snip.css("margin-left", -1 * $snip.width());
    //drawer anim
    $(snippetsLabel.node()).click(function () {
        //console.log(parseInt($snip.css("margin-top")));
        if (parseInt($snip.css("margin-top")) < -1) {
            $label.text("-");
            //shift the whole container up if we would go below bottom of screen
            let offsetX = $('#mapSVG').innerWidth() - $popoverContainer.position().left
                                               - $(headerContainer.node()).width()
                                               - $snip.outerWidth()
                                               - 15; //pad
            let offsetY = $('#mapSVG').innerHeight() - $popoverContainer.position().top
                                                - $(headerContainer.node()).height()
                                                - $snip.outerHeight()
                                                - $label.outerHeight()
                                                - 15; //pad;


            if (offsetX < 0 || offsetY < 0) {
                offsetX = Math.min(offsetX,0);
                offsetY = Math.min(offsetY,0);
                $popoverContainer.attr("offset_x", offsetX);
                $popoverContainer.attr("offset_y", offsetY);
                $popoverContainer.velocity({ 'left' : $popoverContainer.position().left + offsetX,
                                            'top' : $popoverContainer.position().top + offsetY }, 500, "swing");
            }
            $snip.velocity({
                "margin-top" : 0,
                "margin-left" : 0
            }, 500, "swing");
            $popoverContainer.css("z-index", 2000);


        }
        else {
            $label.text("+");
            $snip.velocity({
                "margin-top" : -1 * $(contentContainer.node()).height(),
                "margin-left" : -1 * $(contentContainer.node()).width()
            }, 500, "swing");
            $popoverContainer.css("z-index", 999);

            let offsetX = $popoverContainer.attr("offset_x");
            let offsetY = $popoverContainer.attr("offset_y");
            if (offsetX < 0 || offsetY < 0) {
                $popoverContainer.attr("offset_x", 0);
                $popoverContainer.attr("offset_y", 0);
                offsetX = Math.min(offsetX,0);
                offsetY = Math.min(offsetY,0);
                $popoverContainer.velocity({ 'left' : $popoverContainer.position().left - offsetX,
                                            'top' : $popoverContainer.position().top - offsetY }, 500, "swing");
            }
        }
    });




};


SVGOverlay.prototype.fillSelectionPopover = function( node, wrapperElement, expandable ) {

    let containerElement = d3.select(wrapperElement)
                    .attr("node_id", node.id)
                    .attr("class", "popover-wrapper")
                    .append("div");
    containerElement.attr("class", "popover selection-popover");

    let infobox = containerElement.append("div").attr("class", "infobox");

    let row = node.data_rows[0];

    let name = node.data_src[row]['name'].trim();
    let neighborhood = node.data_src[row]['neighborhood'];
    let categories = node.data_src[row]['categories'];
    let rating = node.data_src[row]['rating'];
    let ratingImg = rating.toFixed(1) + '.png';
    let url = node.data_src[row]['url'];
    let highlights = node.data_src[row]['highlights'];
    let num_reviews = node.data_src[row]['num_reviews'];
    let images = node.data_src[row]['images'];
    let price = node.data_src[row]['price'];

    //small box starts here
    let headerContainer = infobox.append("div");
    headerContainer.attr("class", "header");

    headerContainer.append("div").attr("class", "title");
    headerContainer.select('.title').append("span")
        .attr("class","name no-overflow")
        .text(name);


    headerContainer.append("div").attr("class", "ratings");
    headerContainer.select('.ratings').append("span").attr("class","rank").text('#'+node.rank);
    headerContainer.select('.ratings').append("span").append("img")
        .attr("src", ratingImg);

    headerContainer.append("div").attr("class", "explanation");
    headerContainer.select('.explanation').append("span").text(explainLeaf(node));


};




SVGOverlay.prototype.fillLeafPopover = function( node, projection, wrapperElement, expandable ) {

    let containerElement = d3.select(wrapperElement)
                    .attr("node_id", node.id)
                    .attr("class", "popover-wrapper")
                    .append("div");
    containerElement.attr("class", "popover leaf-popover");
    containerElement.data([node]);

    let infobox = containerElement.append("div").attr("class", "infobox");


    let row = node.data_rows[0];

    let name = node.data_src[row]['name'].trim();
    let neighborhood = node.data_src[row]['neighborhood'];
    let categories = node.data_src[row]['categories'];
    let rating = node.data_src[row]['rating'];
    let ratingImg = rating.toFixed(1) + '.gif';
    let url = node.data_src[row]['url'];
    let highlights = node.data_src[row]['highlights'];
    let num_reviews = node.data_src[row]['num_reviews'];
    let images = node.data_src[row]['images'];
    let price = node.data_src[row]['price'];

    //small box starts here
    let headerContainer = infobox.append("div");
    headerContainer.attr("class", "header");

    headerContainer.append("div").attr("class", "title");
    headerContainer.select('.title').append("a")
        .attr("class","name no-overflow")
        .attr("href",url)
        .attr("target","_blank")
        .text(name);


    headerContainer.append("div").attr("class", "ratings");
    headerContainer.select('.ratings').append("img")
        .attr("src", ratingImg);
    headerContainer.select('.ratings').append("span")
        .text(num_reviews + " reviews");

    headerContainer.append("div").attr("class", "details");
    headerContainer.select('.details').append("span")
        .attr("class", "price spacer-after")
        .text(price);

    if (categories.length > 1) {
        headerContainer.select('.details').append("span")
            .attr("class", "spacer-after no-overflow")
            .text(categories[0]);
        headerContainer.select('.details').append("span")
            //no spacer for final category!
            .attr("class", "no-overflow")
            .text(categories[1]);
    }
    else {
        headerContainer.select('.details').append("span")
            //no spacer for final category!
            .attr("class", "no-overflow")
            .text(categories[0]);
    }

    //small box ends here

    let imagesContainer = infobox.append("div")
                                    .attr("class", "imageContainer");
    let imagesList = imagesContainer.append("ul");

    imagesList.attr("id", "imageList");
    let i=0;
    while (i<images.length) {
        imagesList.append('li')
                       .append('div')
                       .attr('class','imageWrapper')
                       .append("img")
                       .attr("src",images[i])
                       .attr("width", "110px");
        i++;
    }


    $(imagesList.node()).lightSlider({
        item: 1,
        autoWidth: true,
        slideMove: 1, // slidemove will be 1 if loop is true
        slideMargin: 0,
        gallery: false,
        pager: false,
        loop:false,
    });

    //s
    //only add details expand if there is enough stuff to show

    let $popoverContainer = $(containerElement.node());
    if (expandable && (highlights.length > 0 || images.length > 1)) {

        infobox.style("padding-bottom", "0"); //clear padding on infobox if adding snips
        let contentContainer = containerElement.append("div").attr("class", "expandableContent");
        let snippetsLabel = contentContainer.append("div").attr("class", "expandLabel");

        let snippetsContainer = contentContainer.append("div").attr("class", "snippetsWrapper");
        let snippetsDrawer = snippetsContainer.append("div").attr("class","snippetsDrawer");

        //populate the snippets
        let list = snippetsDrawer.append("div").attr("class","snippets").append("ul");
        i = 0;
        while (i < highlights.length) {
            list.append("li").text(highlights[i]);
            i++;
        }

        let $snip = $(snippetsDrawer.node()).show();
        let $label = $(snippetsLabel.node()).text("Click to see more details");
        let $imgContainer = $(imagesContainer.node());
        $snip.css("margin-top", -1 * $snip.height());
        $snip.css("margin-left", -1 * $snip.width());
        //drawer anim
        $(contentContainer.node()).click(function () {
            //console.log(parseInt($snip.css("margin-top")));
            if (parseInt($snip.css("margin-top")) < -1) {
                $label.text("Click to close");
                $snip.velocity({
                    "margin-top" : 0,
                    "margin-left" : 0
                }, 500, "swing");
                $imgContainer.attr("origSize", $imgContainer.css("width"));
                $imgContainer.velocity({
                    "width" : 380
                }, 500, "swing");
                $popoverContainer.css("z-index", 2000);
            }
            else {
                $label.text("Click to see more details");
                $snip.velocity({
                    "margin-top" : -1 * $(contentContainer.node()).height(),
                    "margin-left" : -1 * $(contentContainer.node()).width()
                }, 500, "swing");
                $imgContainer.velocity({
                    "width" : $imgContainer.attr("origSize")
                }, 500, "swing");
                $popoverContainer.css("z-index", 999);
            }
        });
    }



};


SVGOverlay.prototype.fillGroupPopover = function ( node, containerElement ) {


};















//MARK ---------------------- CANVAS TILING








var BOX_SIZE = 4; //(usually 2x circle radius)

var allCircles = [];
var circleIDtoCircle = {};
var datarowToCircle = {};
var circle_quad_tree = null
SVGOverlay.prototype.generateSVGCirclesForClustersAtCurrentZoom = function (nodes) {

    //clear old circles out
    $("#circles_overlay").children("circle.display").remove();


    let projection = this.map.getProjection();
    let projectionScreen = this.getProjection();
    let bounds = this.map.getBounds();
    let zoom = this.map.getZoom();
    let latMin = bounds.getSouthWest().lat();
    let latMax = bounds.getNorthEast().lat();
    let lonMin = bounds.getSouthWest().lng();
    let lonMax = bounds.getNorthEast().lng();
    latMin = latMin - Math.abs(latMax - latMin) * 0.05;
    latMax = latMax + Math.abs(latMax - latMin) * 0.05;
    lonMin = lonMin - Math.abs(lonMax - lonMin) * 0.05;
    lonMax = lonMax + Math.abs(lonMax - lonMin) * 0.05;


    function isInBounds(lat, lon) {
        if ((lat > latMin) && (lat < latMax) &&
           (lon > lonMin) && (lon < lonMax)) {
            return true;
           }
        else {
            return false;
        }
    }

    let runningID = 0;
    allCircles = [];
    circleIDtoCircle = {};
    datarowToCircle = {};

    let i = nodes.length - 1;
    while (i>=0) {
        let node = nodes[i];

        let circles = this.forceNodesForCluster(node, projectionScreen);

        let j=circles.length-1;
        while (j>=0) {
            //sort them into tiles
            let circle = circles[j];
            circle['cluster'] = node;
            circle['i'] = runningID;

            allCircles.push(circle);
            circleIDtoCircle[runningID] = circle;
            let r = circle.data_rows.length;
            while (r>=0) {
                datarowToCircle[circle.data_rows[r]] = circle;
                r--;
            }

            runningID++;
            j--;
        }



        i--;
    }

    circle_quad_tree = d3.quadtree()
        .x(function(d) {return d.x;})
        .y(function(d) {return d.y;})
        .addAll(allCircles);

    applyActiveWeightsTo(allCircles);

    this.simulateWithBins(allCircles);



};

SVGOverlay.prototype.updateSVGCirclesOnScreen = function () {

    let starting_bounds = STARTING_ZOOM_SW_REF;
    let bounds = this.map.getBounds();
    let projection = this.getProjection();
    let orig_corner_proj = projection.fromLatLngToContainerPixel(starting_bounds);
    let cur_corner_proj = projection.fromLatLngToContainerPixel(bounds.getSouthWest());
    let cur_ne_proj = projection.fromLatLngToContainerPixel(bounds.getNorthEast());
    let left = cur_corner_proj.x;
    let top = cur_ne_proj.y;
    let right = cur_ne_proj.x;
    let bot = cur_corner_proj.y;
    let translate_x = orig_corner_proj.x - cur_corner_proj.x;
    let translate_y = orig_corner_proj.y - cur_corner_proj.y;

    let queue = {}; //null for not unscreen, remove if present, left 1 if need to be made
    let temp = [];


    /*

    circle_quad_tree.visit(function(node, x1, y1, x2, y2) {
    if (!node.length) {
      do {
        let d = node.data;
        let x = d.x+translate_x;
        let y = d.y+translate_y;
        if ((x >= left) && (x < right) && (y >= top) && (y < bot)) {
            queue[d.i] = 1;
        }
      } while (node = node.next);
    }
    return x1 >= right || y1 >= bot || x2 < left || y2 < top;
    });*/

    let i=allCircles.length-1;
    while (i>=0) {
        let d = allCircles[i];
        let x = d.x+translate_x;
        let y = d.y+translate_y;
        if ((x >= left) && (x < right) && (y >= top) && (y < bot)) {
            queue[d.i] = 1;
        }
        i--;
    }


    //loop through present circles
    $("#circles_overlay").children("circle.display").each( function() {

        let e = d3.select(this);
        let id = parseInt(e.attr("i"));
        if (id in queue) {
            let circle = circleIDtoCircle[id];
            e.attr("fill",circle.color)
                .attr("cx", Math.floor(circle.x))
                .attr("cy", Math.floor(circle.y))
                .attr("r", Math.round(circle.r))
                .property("opaque", circle.opaque)
                .attr("opacity", circle.opacity);

            delete queue[id]; //if drawn and in queue, keep it
            //UPDATE THE POINT STYLE HERE IF NEED BE
        }
        else {
            delete circleIDtoCircle[id]['htmlnode'];
            e.remove(); //if drawn but not in queue, delete
        }

    });
    for (let k in queue) { //if in queue but not drawn, draw it
        let circle = circleIDtoCircle[k];

        let circleElement = d3.select("#circles_overlay").append("circle")
                                .attr("class","display")
                                .attr("i", k)
                                .attr("cx", Math.floor(circle.x))
                                .attr("cy", Math.floor(circle.y))
                                .attr("r", Math.round(circle.r))
                                .attr("stroke", "#444")
                                .attr("opacity", circle.opacity)
                                .property("opaque", circle.opaque)
                                .attr("fill",circle.color)
                                .attr("stroke-width", "1px");

        circle.htmlnode = circleElement.node();


    }


    d3.select("#circles_overlay").style("transform","translate("+Math.floor(translate_x)+"px,"+Math.floor(translate_y)+"px)")
                                 .attr("t_x",Math.floor(translate_x))
                                 .attr("t_y",Math.floor(translate_y));

    d3.select("#animation_overlay").style("transform","translate("+Math.floor(translate_x)+"px,"+Math.floor(translate_y)+"px)");


};


SVGOverlay.prototype.temporarilyRecolorSVGCircles = function (weightFunction) {

    d3.selectAll("circle.display").each(function() {

        let e = d3.select(this);
        let circle = circleIDtoCircle[parseInt(this.getAttribute("i"))];
        let wf = weightFunction(circle.data_rows);

        if (wf.color) {
            if (e.attr("old_fill") == null) {
                e.attr("old_fill",e.attr("fill"));
            }
            e.attr("fill",wf.color);
        }
        if (wf.opaque == null) {
            e.attr("opacity",1);
        }
        else {
            e.attr("opacity", 0.4 + wf.opaque*0.6);
        }


    });

};

SVGOverlay.prototype.returnRecolorSVGCircles = function () {

    d3.selectAll("circle.display").each(function() {

        let e = d3.select(this);
        if (e.attr("old_fill")) {
            e.attr("fill",e.attr("old_fill"));
            e.attr("old_fill",null);
        }
        e.attr("opacity",1);

    });
};





SVGOverlay.prototype.forceNodesForCluster = function (node, projection) {

    let bins = {};
    let i=node.data_rows.length-1;
    while (i>=0) {
        let n = node.data_rows[i];

        let latLng = new google.maps.LatLng(node.data_src[n][LATVAL], node.data_src[n][LONVAL]);
        let proj = projection.fromLatLngToContainerPixel(latLng);

        let x_ind = Math.floor(proj.x / BOX_SIZE);
        let y_ind = Math.floor(proj.y / BOX_SIZE);


        if (!(x_ind in bins)) {
            bins[x_ind] = {};
        }
        if (!(y_ind in bins[x_ind])) {
            bins[x_ind][y_ind] = [];
        }

        bins[x_ind][y_ind].push({
            x: proj.x,
            dx: proj.x,
            lat: latLng.lat(),
            lon: latLng.lng(),
            y: proj.y,
            dy: proj.y,
            data_rows: n
        });

        i--;
    }

    let circles = [];
    /*let x_min = Number.MAX_VALUE;
    let x_max = Number.MIN_VALUE;
    let y_min = Number.MAX_VALUE;
    let y_max = Number.MIN_VALUE;*/
    for (let x in bins) {
        for (let y in bins[x]) {

            //take off the top for now
            let n = bins[x][y].pop();
            n.data_rows = [n.data_rows];

            //aggregate rows together
            while(bins[x][y].length > 0) {
                n.data_rows.push(bins[x][y].pop().data_rows);
            }

            //update the size

            //n['r'] = CIRCLE_SIZE;

            // x_min = Math.min(x_min, n.x);
            // x_max = Math.max(x_max, n.x);
            // y_min = Math.min(y_min, n.y);
            // y_max = Math.max(y_max, n.y);

            circles.push(n);

        }
    }

    return circles;

};

SVGOverlay.prototype.simulateWithBins = function (circles) {


    //add heuristic here to pick correct bins

    let temp = this;
    this.circlemodel = d3.forceSimulation()
                     //.alphaDecay(0.1)
                     //.force("fx",d3.forceX(function(d) {return(d.dx);}).strength(0.05))
                     //.force("fy",d3.forceY(function(d) {return(d.dy);}).strength(0.05))
                     .force("collideForce",d3.forceCollide(function(d) {return d.r;}).strength(1).iterations(5))
                     .nodes(circles)
                     //.on("tick", function() { OVERLAY.updateSVGCirclesOnScreen(); });
    this.circlemodel.stop();
    let iters = 0;
    while(iters < 10) {
        this.circlemodel.tick();
        iters++;
    }
    this.circlemodel.stop();

    return circles;
            /*offset: {x: x_min, y: y_min},
            width: x_max-x_min,
            height: y_max-y_min};*/

};


SVGOverlay.prototype.resetSimulation = function () {
    this.circlemodel.stop();

    let i=allCircles.length-1;
    while (i>=0) {
        let c = allCircles[i];
        c.x = c.dx;
        c.y = c.dy;
        i--;
    }

    this.circlemodel = d3.forceSimulation()
                     //.alphaDecay(0.1)
                     //.force("fx",d3.forceX(function(d) {return(d.dx);}).strength(0.05))
                     //.force("fy",d3.forceY(function(d) {return(d.dy);}).strength(0.05))
                     .force("collideForce",d3.forceCollide(function(d) {return d.r;}).strength(1).iterations(5))
                     .nodes(allCircles);
                     //.on("tick", function() { OVERLAY.updateSVGCirclesOnScreen(); });
    this.circlemodel.stop();
    let iters = 0;
    while(iters < 10) {
        this.circlemodel.tick();
        iters++;
    }
    this.circlemodel.stop();
    this.updateSVGCirclesOnScreen();
};











var rad = function(x) {
  return x * Math.PI / 180;
};
var getDistance = function(p1, p2) {
  var R = 6378137; // Earth’s mean radius in meter
  var dLat = rad(p2.lat - p1.lat);
  var dLong = rad(p2.lng - p1.lng);
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(p1.lat)) * Math.cos(rad(p2.lat)) *
    Math.sin(dLong / 2) * Math.sin(dLong / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  var d = R * c;
  return d; // returns the distance in meter
};



//0-0-0-0-0-0-0-0-0-0-0-0-0-0--READY--0-0-0-0-0-0-0-0-0-0-0-0-0-0
//-0-0-0-0-0-0-0-0-0-0-0-0-0-0-------0-0-0-0-0-0-0-0-0-0-0-0-0-0-


function ready(data) {

    //console.log(data);

    DATASET = data;


    var el = document.querySelector('#map');
    var google = window.google;



    var latScale = getScaleForDatatype(data, LATVAL, 1);
    var lonScale = getScaleForDatatype(data, LONVAL, 1);



    var southWest = new google.maps.LatLng(latScale.domain()[1], lonScale.domain()[0]);
    var northEast = new google.maps.LatLng(latScale.domain()[0], lonScale.domain()[1]);
    var BOUNDS = new google.maps.LatLngBounds(southWest,northEast);

    //set up padding for viewport bounds checking
    LATPAD = Math.abs(latScale.domain()[1] - latScale.domain()[0]) * 0.01;
    LONPAD = Math.abs(lonScale.domain()[1] - lonScale.domain()[0]) * 0.01;


    //normalize latLng
    let norm_data = [];
    let i=0;
    for (let r of data) {
        let n = new Object();
        n.id = i;
        i++;
        n.x = latScale(r[LATVAL]);
        n.y = lonScale(r[LONVAL]);
        norm_data.push(n);
    }

    //console.log(norm_data);

    //CLUSTERING HERE ------------------------------
    var threshold = 0.3; // only combine two clusters with distance less than 14

    var clusters = clusterfck.hcluster(norm_data, function(a,b) {return Math.sqrt(Math.pow(a.x-b.x,2) + Math.pow(a.y-b.y,2)); },
        clusterfck.AVERAGE_LINKAGE, threshold);


    //BUILD PROPER TREE STRUCTURE ------------------------------

    var runningID = 0;
    LEAF_NODES = [];
    function postTraverse(node, data, depth) {   //node to traverse from, pointer to data table
        if (node.size < 2) {
            let leaf = new Node(runningID, data, [node.value.id], null, [], depth);
            ALL_NODES.push(leaf);
            NODEID_TO_NODE[runningID] = leaf;
            LEAFROW_TO_NODE[node.value.id] = leaf;
            runningID++;
            LEAF_NODES.push(leaf);
            return leaf;
        }


        let lN = postTraverse(node.left, data, depth+1);
        let rN = postTraverse(node.right, data, depth+1);

        let children = [lN, rN];
        let data_rows = lN.data_rows.concat(rN.data_rows);
        let groupN = new Node(runningID, data, data_rows, null, children, depth);
        lN.parentNode = groupN;
        rN.parentNode = groupN;
        ALL_NODES.push(groupN);
        NODEID_TO_NODE[runningID] = groupN;
        runningID++;

        //precompute the average lat/lng
        groupN.dataValue(LATVAL);
        groupN.dataValue(LONVAL);

        return groupN;
    }

    //adjust clusters into Node structure
    for (let root of clusters) {

        let rootNode = postTraverse(root, data, 1);
        ROOT_NODES.push(rootNode);

    }
    var VIRTUAL_ROOT = new Node(-1, data, [], null, ROOT_NODES, 0);
    //console.log(VIRTUAL_ROOT);


    //push the LEAF Nodes into a quadtree for faster geo lookups
    LEAF_QUAD_TREE = d3.quadtree()
        .x(function(d) {return d.dataValue(LONVAL);})
        .y(function(d) {return d.dataValue(LATVAL);})
        .addAll(LEAF_NODES);


    //update the proximity figures for each node
    var NEARBY_THRESHOLD = 500;
    let x=LEAF_NODES.length-1;
    while(x>=0) {
        let nearby = []
        let nx = LEAF_NODES[x];
        let y=LEAF_NODES.length-1;
        while(y>=0) {
            if (x != y) {
                let ny=LEAF_NODES[y];

                if (getDistance({lat: data[nx.data_rows[0]][LATVAL],
                                 lng: data[nx.data_rows[0]][LONVAL]},
                                {lat: data[ny.data_rows[0]][LATVAL],
                                 lng: data[ny.data_rows[0]][LONVAL]}) <= NEARBY_THRESHOLD) {
                    nearby.push(ny.data_rows[0]);
                }
            }
            y--;
        }
        nx.nearby_rows = nearby;
        x--;
    }


    //console.log(LEAF_NODES);


    //gather initial stats
    gatherStats(LEAF_NODES);


    populateWeights(); //create the default set of user weights
    updateLeafRankings(); //call again later if need to update


    //setup collapsible menus
    $("#filterConfig .collapseButton").click(function()
    {
        //console.log($(this))
        var curwidth = $(this).parent().offset(); //get offset value of the parent element
        if($(this).prop("closed")) //compare margin-left value
        {
            //animate margin-left value to -490px
            $(this).parent().animate({marginLeft: "0"}, 300 );
            $(this).html('hide'); //change text of button
            $(this).prop("closed",false);
        }else{
            //animate margin-left value 0px
            $(this).parent().animate({marginLeft: -$(this).parent().width() - 4 + "px"}, 300 );
            $(this).html('show'); //change text of button
            $(this).prop("closed",true);
        }
    });


  //BUILD THE MAP ITSELF
  var map = new google.maps.Map(el, {
    disableDefaultUI: true,
    zoomControl: true,
    zoomControlOptions: {
        position: google.maps.ControlPosition.BOTTOM_CENTER
    },
    scrollwheel: false,
    clickableIcons: false,
    backgroundColor: '#FFFFFF'
  });

  $(window).resize(function() {
    // (the 'map' here is the result of the created 'var map = ...' above)
    FORCED_RESIZE = true;
    google.maps.event.trigger(map, "resize");
  });

  map.fitBounds(BOUNDS);


  fetch('mapstyles.json')
    .then((response) => response.json())
    .then(function (styles) {
      map.mapTypes.set('neutral', new google.maps.StyledMapType(styles));
      map.setMapTypeId('neutral');
    });

 OVERLAY= new SVGOverlay(map, data);



     $("#sidebar .collapseButton").prop("closed",true);
     $("#sidebar .collapseButton").click(function()
     {
         //console.log($(this))
         var curwidth = $(this).parent().offset(); //get offset value of the parent element
         if($(this).prop("closed")) //compare margin-left value
         {
             //animate margin-left value to -490px
             $(this).parent().animate({marginRight: "0"}, 300 );
             $(this).html('hide'); //change text of button
             $(this).prop("closed",false);
             SHOULD_SHOW_POPOVERS = true;
             OVERLAY.updateRecommendedPopovers();
             OVERLAY.updatePopoverObjectsFromForce(false, false);
         }else{
             //animate margin-left value 0px
             $(this).parent().animate({marginRight: -$(this).parent().width() - 4 + "px"}, 300 );
             $(this).html('show'); //change text of button
             $(this).prop("closed",true);
             SHOULD_SHOW_POPOVERS = false;
             OVERLAY.updateRecommendedPopovers();
             OVERLAY.updatePopoverObjectsFromForce(false, false);
         }
     });






}





    /*


    var xVal = 'latitude';
    var yVal = 'longitude';

    var xScale = getScaleForDatatype(data, xVal, 1);
    var yScale = getScaleForDatatype(data, yVal, 1);

    var reverseXScale = d3.scaleLinear()
                          .domain(xScale.range())
                          .range([0,1]);
    var reverseYScale = d3.scaleLinear()
                          .domain(yScale.range())
                          .range([0,1]);




    var xAxis = d3.axisBottom(xScale);

    var yAxis = d3.axisLeft(yScale);

    //console.log(d3.extent(data, function(d) { return d[xVal]; }))
    //console.log(d3.extent(data, function(d) { return d[yVal]; }))


    //normalize XYZ
    norm_data = [];
    i=0;
    for (let r of data) {
        n = new Object();
        n.id = i;
        i++;
        n.x = reverseXScale(xScale(r[xVal]));
        n.y = reverseYScale(yScale(r[yVal]));
        norm_data.push(n);
    }

    //CLUSTERING HERE ------------------------------
    //var clusterfck = require("clusterfck");
    var threshold = 0.3; // only combine two clusters with distance less than 14

    var clusters = clusterfck.hcluster(norm_data, function(a,b) {return Math.sqrt(Math.pow(a.x-b.x,2) + Math.pow(a.y-b.y,2)) },
        clusterfck.AVERAGE_LINKAGE, threshold);


    //BUILD PROPER TREE STRUCTURE ------------------------------

    var runningID = 0;
    function postTraverse(node, data, depth) {   //node to traverse from, pointer to data table
        if (node.size < 2) {
            let leaf = new Node(runningID, data, [node.value.id], null, [], depth);
            ALL_NODES.push(leaf);
            runningID++;
            return leaf;
        }


        let lN = postTraverse(node.left, data, depth+1);
        let rN = postTraverse(node.right, data, depth+1);

        let children = [lN, rN];
        let data_rows = lN.data_rows.concat(rN.data_rows);
        let groupN = new Node(runningID, data, data_rows, null, children, depth);
        runningID++;
        lN.parentNode = groupN;
        rN.parentNode = groupN;
        ALL_NODES.push(groupN);

        return groupN
    }

    //adjust clusters into Node structure
    for (let root of clusters) {

        rootNode = postTraverse(root, data, 1);
        ROOT_NODES.push(rootNode);

    }
    var VIRTUAL_ROOT = new Node(-1, data, [], null, ROOT_NODES, 0);
    console.log(VIRTUAL_ROOT);


    //TREE GRAPH  ------------------------------
    //Draw the tree graph
    var tree = d3.tree()
     .size([360, 200])
     .separation(function(a, b) { return (a.parentNode == b.parentNode ? 1 : 2) / a.depth; });;
    //console.log(tree);

    var line = d3.line()
             .x(function(d){ return d.x; })
             .y(function(d){return d.y; });
    function lineData(d){
        var points = [
            {x: d.x, y: d.y},
            {x: d.parentNode.x, y: d.parentNode.y}
        ]
        return line(points);
    }

    // Compute the new tree layout.
    var root = d3.hierarchy(VIRTUAL_ROOT);
    tree(root);

    function project(x, y) {
        var angle = (x - 90) / 180 * Math.PI, radius = y;
        return [radius * Math.cos(angle), radius * Math.sin(angle)];
    }
    function updateTree() {
        var link = treesvg.selectAll(".link")
          .data(root.descendants().slice(1))
        .enter().append("path")
          .attr("class", "link")
          .attr("d", function(d) {
            return "M" + project(d.x, d.y)
                + "C" + project(d.x, (d.y + d.parentNode.y) / 2)
                + " " + project(d.parentNode.x, (d.y + d.parentNode.y) / 2)
                + " " + project(d.parentNode.x, d.parentNode.y);
          });

        var node = treesvg.selectAll(".node")
          .data(root.descendants())
        .enter().append("g")
          .attr("class", function(d) { return "node" + (d.children ? " node--internal" : " node--leaf"); })
          .attr("transform", function(d) { return "translate(" + project(d.x, d.y) + ")"; });

        node.append("circle")
          .attr("r", 1)
          .style("stroke", function(d) {
                    if (d.highlighted) {
                        return "purple";
                    }
                    else {
                        return "steelblue";
                    }
                });

    }
    updateTree();

    //END TREE GRAPH ------------------------------


    var slicedNodes = [];

    function updateSlices(sliderVal) {

        //SLIDER UPDATE SCRIPT ------------------------------

        let targetNum = Math.round(data.length * sliderVal);
        //console.log(targetNum);

        //clear up highlights
        for (node of ALL_NODES) {
            node.highlighted = false;
            node.groupMember = false;

            //preload some physics values
            node.x = xScale(node.dataValue(xVal));
            node.y = yScale(node.dataValue(yVal));
            node.radius = Node.circleSize(node);
        }

        //do a BFS to do the slicing for now
        slicedNodes = [];
        let queue = [];
        for (let root of ROOT_NODES) {
            queue.push(root);
        }
        while (queue.length > 0) {
            let cur = queue.shift();

            if (cur.children.length === 0) { //hit a leaf node, add it to the list
                slicedNodes.push(cur);
            }
            else {
                if (queue.length + slicedNodes.length >= targetNum) {
                    //we're at saturation, kill the loop after appending the queue
                    for (let node of queue) {
                        slicedNodes.push(node);
                    }
                    break;
                }
                else {
                    for (let child of cur.children) {
                        queue.push(child)
                    }
                }

            }

        }

        //console.log(slicedNodes.length);

        //update tree highlights by simple tree traversal
        function perc(node, isTop) {
            if (node.highlighted) {
                console.log("WARNING -- CYCLE FOUND DURING HIGHLIGHTING");
            }
            if (isTop) {
                node.highlighted = true;
            }
            else {
                node.groupMember = true;
            }
            for (let child of node.children) {
                perc(child, false);
            }
        }
        for (let node of slicedNodes) {
            perc(node, true);
        }


        // transition
        var t = d3.transition()
              .duration(500);

        //update the tree diagram with the cut
        d3.selectAll(".node circle").transition(t).style("stroke", function(d) {
                        if (d.data.highlighted) {
                            return "red";
                        }
                        else if (d.data.groupMember) {
                            return "yellow";
                        }
                        else {
                            return "steelblue";
                        }
                    });





       //console.log('update');
       //set up all nodes as paths -- we get fancy enclosing ones for groups

        var node = g.selectAll("path.point")
          .data(slicedNodes);

        node.enter().append("path")
            .attr("class", "point")
            .attr('fill', '#aca')
            .attr('stroke', '#888')
            .attr('stroke-width', '2px');

        //node.attr("r", function(d) {return circleSize(d);})
        //    .attr("cx", function(d) { return d.x; })
        //    .attr("cy", function(d) { return d.y; });

        node.attr('d', function(d) {return d.getPathDScale(xVal, xScale, yVal, yScale);});
        node.exit().remove();

        //END SLIDER UPDATE SCRIPT ------------------------------
    }


    updateSlices(d3.select("#group-slider").attr("value"));
    //bind slider update to refresh sim and tree with new slices
    var slide = document.getElementById('group-slider');
    slide.onchange = function() {
        updateSlices(this.value);
    }


    //set up all nodes as paths -- we get fancy enclosing ones for groups
    var node = g.selectAll(".point")
      .data(slicedNodes)
      .enter().append("path")
        .attr("class", "point")
        .attr('fill', '#aca')
        .attr('stroke', '#888')
        .attr('stroke-width', function(d) {console.log('add: '+d.id);return '2px';});

    //node.attr("r", function(d) {return circleSize(d);})
    //    .attr("cx", function(d) { return d.x; })
    //    .attr("cy", function(d) { return d.y; });

    node.attr('d', function(d) {console.log('update: '+d.id);return d.getPathDScale(xVal, xScale, yVal, yScale);});

    node.exit().remove();

    //console.log('build axes');
    //axes setup

    g.append("g")
      .attr("class", "x axis")
      .attr("transform", "translate(0," + height + ")")
      .call(xAxis)
    .append("text")
      .attr("class", "label")
      .attr("x", width)
      .attr("y", -6)
      .style("text-anchor", "end")
      .text(xVal);

    g.append("g")
      .attr("class", "y axis")
      .call(yAxis)
    .append("text")
      .attr("class", "label")
      .attr("transform", "rotate(-90)")
      .attr("y", 6)
      .attr("dy", ".71em")
      .style("text-anchor", "end")
      .text(yVal);


}
*/
