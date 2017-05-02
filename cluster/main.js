
//beefy main.js:bundle.js -- -t [ babelify --presets [ es2015 ] ]

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
var PADDING = 0;
var DATASET = null;

var FORCE_MODEL = null;

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
        this.vals = new Object(); //lazy load for dataValues
        this.highlighted = false;
        this.groupMember = false;
        this.isOnScreen = true; //assume should be drawn unless marked otherwise
        this.isOnScreenPadded = true; //assume should be drawn unless marked otherwise

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
var CLUSTER_SKIP_SIZE = 5; //clusters of this size or lower aren't broken up further, but may combine with other clusters during the merge phase if they are too small onscreen
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



    priorityQueue = new Heap(function(a,b) {
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
    let priorityQueue = new Heap(function(a,b) {
        return -(b.depth - a.depth);   //put the stuff at the top of the tree first
    });
    let finalNodes = [];



    //route them by area
    i=processedNodes.length-1;
    while (i>=0) {
        let node = processedNodes[i];
        let centroid = node.getHullCentroid(LATVAL, LONVAL);

        if (node.data_rows.length <= CLUSTER_SKIP_SIZE) {
            node.isOnScreen = isInBounds(centroid[0],centroid[1]);
            node.isOnScreenPadded = isInBoundsPadded(centroid[0],centroid[1]);
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
            node.isOnScreen = false;
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

var QUANT_NUM_BINS = 60;
//var ALL_QUANT_BINS = [];

function quantizeNode(node, latVar, lonVar, width, height, projection) {
    //uses projection to convert to screenspace since we don't want jitter from noisy projection

    //for now let's just divide the screen into N by N boxes
    let binSize;

    if (width >= height) {
        binSize = width / QUANT_NUM_BINS;
    }
    else {
        binSize = height / QUANT_NUM_BINS;
    }

    binSize = 5;

    let maxW = Math.ceil(width / binSize);
    let maxH = Math.ceil(height / binSize);

    let quantBins = [];
    let quantMap = {};
    let qid = 0;
    function binFor(lat, lon) {

        let latLng = new google.maps.LatLng(lat, lon);
        let proj = projection.fromLatLngToContainerPixel(latLng);

        let x_ind = Math.floor(proj.x / binSize);
        let y_ind = Math.floor(proj.y / binSize);

        //if the bin is outside the viewport, don't even create it
        if (x_ind < 0 || x_ind > maxW || y_ind < 0 || y_ind > maxH) {
            return null;
        }


        if (!(x_ind in quantMap)) {
            quantMap[x_ind] = {};
        }
        if (!(y_ind in quantMap[x_ind])) {
            quantMap[x_ind][y_ind] = new QuantizationBin( qid,
                                                  x_ind,
                                                  y_ind,
                                                  x_ind*binSize,
                                                  y_ind*binSize,
                                                  binSize );
            quantBins.push(quantMap[x_ind][y_ind]);
            //ALL_QUANT_BINS.push(quantMap[x][y]);

            qid++;
        }

        return quantMap[x_ind][y_ind];

    }

    let m = 0;

    let i=node.data_rows.length-1;
    while (i>=0) {
        let row = node.data_rows[i];

        let bin = binFor(node.data_src[row][latVar],
                         node.data_src[row][lonVar]);
        if (bin) {
            bin.addRow(row);
            m = Math.max(bin.data_rows.length, m);
        }


        i--;
    }



    return [quantBins, m];



}






/*
//doing a flat heuristic makes clusters jump around -- better to selectively break down
function targetForZoomLevel(zoom) {
    if (zoom >= 16) {
        return 100;  //when very close, see all as points
    }
    else if (zoom === 15) {
        return 4;
    }
    else if (zoom === 14) {
        return 10;
    }
    else if (zoom === 13) {
        return 16;
    }
    else if (zoom === 12) {
        return 24;
    }
    else if (zoom === 11) {
        return 30;
    }
    else if (zoom === 10) {
        return 40;
    }
    else if (zoom <= 9 && zoom > 5) {
        return 60;
    }
    else {
        return 100;
    }
}
*/


// --------------------- END HEURISTICS --------------------







// -------------- BEGIN DATA FEATURE EXTRACTION ------------


var VALID_NUM_COLUMNS = ['rating',
                         'price_numeric',
                         'num_reviews',
                         'ranking',
                         'images',
                         'highlights'];
var NUM_COLUMN_GETTERS = [function(d) {return parseFloat(d);},
                        function(d) {return parseFloat(d);},
                        function(d) {return parseFloat(d);},
                        function(d) {return parseFloat(d);},
                        function(d) {return d.length;},
                        function(d) {return d.length;}];
var VALID_NOM_COLUMNS = ['categories'];

var DESC_STATS = {};
var CLUSTER_STATS = {};
var RAW_SCORES = {};


function gatherStats(leaf_nodes) {

    let scratch = leaf_nodes.slice();

    for (let k=0; k<VALID_NUM_COLUMNS.length; k++) {
        let col = VALID_NUM_COLUMNS[k];
        let getter = NUM_COLUMN_GETTERS[k];

        scratch.sort(function (a,b) {
            let aRating = getter(a.data_src[a.data_rows[0]][col]);
            let bRating = getter(b.data_src[b.data_rows[0]][col]);
            return bRating-aRating;
        });
        let sum=0;
        let i=scratch.length-1;
        while (i>=0) {
            sum = sum + getter(scratch[i].data_src[scratch[i].data_rows[0]][col]);
            i--;
        }
        let mean = sum / scratch.length;
        sum = 0;
        i=scratch.length-1;
        while (i>=0) {
            sum = sum + Math.pow(getter(scratch[i].data_src[scratch[i].data_rows[0]][col]) - mean,2);
            i--;
        }
        let sd = Math.sqrt(sum / scratch.length);

        DESC_STATS[col] = {mean: mean,
                           max: getter(scratch[0].data_src[scratch[0].data_rows[0]][col]),
                           min: getter(scratch[0].data_src[scratch[scratch.length-1].data_rows[0]][col]),
                           median: getter(scratch[0].data_src[scratch[Math.floor(scratch.length/2.0)].data_rows[0]][col]),
                           sd: sd };
        DESC_STATS[col].scale = d3.scaleLinear().domain([DESC_STATS[col].min, DESC_STATS[col].max]).range([0, 1]);


    }

    let pop_cutoff = 0.5;
    let rating_cutoff = 3.9;

    for (let k=0; k<VALID_NOM_COLUMNS.length; k++) {
        let col = VALID_NOM_COLUMNS[k];

        let raw_counts = {};
        let popular_counts = {};
        let best_counts = {};
        let ranked_by_genre = {};

        let i=scratch.length-1;
        while (i>=0) {
            let node = scratch[i];
            let k = node.data_src[node.data_rows[0]][col].length-1;
            while (k>=0) {
                let v = node.data_src[node.data_rows[0]][col][k];
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
                return parseFloat(scratch[0].data_src[b]['ranking']) -
                       parseFloat(scratch[0].data_src[a]['ranking']);
            });
        }

        DESC_STATS[col] = {
            count: raw_counts,
            popular: popular_counts,
            high_rated: best_counts,
            ranked: ranked_by_genre
        };
    }


    console.log(DESC_STATS);
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
            let aRating = getter(n.data_src[a][col]);
            let bRating = getter(n.data_src[b][col]);
            return bRating-aRating;
        });
        let sum=0;
        let i=rows.length-1;
        while (i>=0) {
            sum = sum + getter(n.data_src[rows[i]][col]);
            i--;
        }
        let mean = sum / rows.length;
        sum = 0;
        i=rows.length-1;
        while (i>=0) {
            sum = sum + Math.pow(getter(n.data_src[rows[i]][col]) - mean,2);
            i--;
        }
        let sd = Math.sqrt(sum / rows.length);

        stats[col] = {mean: mean,
                           max: getter(n.data_src[rows[0]][col]),
                           min: getter(n.data_src[rows[rows.length-1]][col]),
                           median: getter(n.data_src[rows[Math.floor(rows.length/2.0)]][col]),
                           sd: sd };
        stats[col].scale = d3.scaleLinear().domain([stats[col].min, stats[col].max]).range([0, 1]);


    }

    let pop_cutoff = 0.5;
    let rating_cutoff = 3.9;

    for (let k=0; k<VALID_NOM_COLUMNS.length; k++) {
        let col = VALID_NOM_COLUMNS[k];

        let raw_counts = {};
        let popular_counts = {};
        let best_counts = {};
        let ranked_by_genre = {};

        let i=rows.length-1;
        while (i>=0) {
            let row = rows[i];
            let k = n.data_src[row][col].length-1;
            while (k>=0) {
                let v = n.data_src[row][col][k];
                let popular = DESC_STATS['num_reviews'].scale(parseFloat(n.data_src[row]['num_reviews']));
                let rating = parseFloat(n.data_src[row]['rating']);

                if (!(v in raw_counts)) {
                    raw_counts[v] = 0;
                    popular_counts[v] = 0;
                    best_counts[v] = 0;
                    ranked_by_genre[v] = [];
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

        for (let col in ranked_by_genre) {
            ranked_by_genre[col].sort(function(a,b) {
                return parseFloat(n.data_src[b]['ranking']) -
                       parseFloat(n.data_src[a]['ranking']);
            });
        }

        stats[col] = {
            count: raw_counts,
            popular: popular_counts,
            high_rated: best_counts,
            ranked: ranked_by_genre
        };
    }

    CLUSTER_STATS[n.id] = stats;
    return stats;

}


function rankLeaves(leaf_nodes) {

    let scratch = leaf_nodes.slice();

    //for now leaving out BOUNDS since it makes the recommendation unstable when panning
    function score(rating, reviews, ranking, picNum, snipNum) {
        //range from 1 to 5.6
        return (rating +
                DESC_STATS['num_reviews'].scale(reviews) * 1.3 + //reviews can boost up or down a score
                DESC_STATS['images'].scale(picNum) * 0.2 + //pictures boost scores
                DESC_STATS['highlights'].scale(snipNum) * 0.5 +
                DESC_STATS['ranking'].scale(ranking) * - 1);

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

        return score(bRating, bReviews, bRanking, bPics, bSnips) -
               score(aRating, aReviews, aRanking, aPics, aSnips);
    });

    /*
    let leaf_ranking = {};
    i=0;
    while(i<ranking.length) {
        leaf_ranking[ranking[i]] = i;
        i++;
    }*/

    return scratch;

}


function explainLeaf(leafNode, cluster) {

    //ignoring user level features for now

    //overall stats
    let overall_list = {
        best: parseFloat(leafNode.data_src[leafNode.data_rows[0]]['ranking']) <= 10,
        rating: DESC_STATS['rating'].scale(parseFloat(leafNode.data_src[leafNode.data_rows[0]]['rating'])) >= 0.9,
        popularity: DESC_STATS['rating'].scale(parseFloat(leafNode.data_src[leafNode.data_rows[0]]['rating'])) >= 0.9,
        genre_top10: [],
        genre_best: [],
    };
    for (let cat of leafNode.data_src[leafNode.data_rows[0]]['categories']) {
        if (DESC_STATS['categories']['ranked'][cat].indexOf(leafNode.data_rows[0]) < 10 &&
            DESC_STATS['categories']['count'][cat] > 10) {
                overall_list.genre_top10.push(cat);
                if (DESC_STATS['categories']['ranked'][cat].indexOf(leafNode.data_rows[0]) === 0 &&
                    DESC_STATS['categories']['count'][cat] > 10) {
                        overall_list.genre_best.push(cat);
                }
        }
    }

    //as compared to cluster



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
    this.updateSlices = this.updateSlices.bind(this);
    this.buildSlices = this.buildSlices.bind(this);
    this.onMouseClick = this.onMouseClick.bind(this);


    this.setMap(map);
}

SVGOverlay.prototype = new google.maps.OverlayView();


SVGOverlay.prototype.buildSlices = function () {


    //console.log("buildslices");

    this.slicedNodes = ROOT_NODES;


    //DEPRECATED - LET THE OBJECTIVE FUNCTION ALGORITHM DO THE BREAKING AT THE START
    /*
    //SLIDER UPDATE SCRIPT ------------------------------
    let sliderVal = d3.select("#group-slider").attr("value");
    console.log(sliderVal);

    let targetNum = Math.round(this.data.length * sliderVal);

    targetNum = MAX_ONSCREEN;  //disregarding slider output
    //console.log(targetNum);
    console.log("target: "+targetNum);



    //do a BFS to do the slicing for now
    this.slicedNodes = [];
    let queue = [];
    for (let root of ROOT_NODES) {
        queue.push(root);
    }
    while (queue.length > 0) {
        let cur = queue.shift();

        if (cur.children.length === 0) { //hit a leaf node, add it to the list

            this.slicedNodes.push(cur);

        }
        else {

            if (queue.length + this.slicedNodes.length >= targetNum) {
                //we're at saturation, kill the loop after appending the queue
                for (let node of queue) {

                    this.slicedNodes.push(node);

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
    */


    this.updateSlices();

};


var PREVIOUS_PX_BOUNDS = []
SVGOverlay.prototype.updateSlices = function () {

    //console.log("updateslices");

    //first combine ANY nodes that are below threshold
    // we only want to break stuff that is visible and then repackage it when out of view
    let bounds = this.map.getBounds();
    let latMin = bounds.getSouthWest().lat();
    let latMax = bounds.getNorthEast().lat();
    let lonMin = bounds.getSouthWest().lng();
    let lonMax = bounds.getNorthEast().lng();

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
        console.log("VIEW_SIZE_CHANGED");
    }
    PREVIOUS_VIEWSIZE = viewSize;

    //console.log('lat'+(latMax-latMin)+' lon'+(lonMax-lonMin)+' view'+viewSize);


    if (viewSizeChanged) {
    this.slicedNodes = adjustClusters(this.slicedNodes, viewSize, isInBounds, isInBoundsPadded);
}
    //scoreNodes(DATASET, this.slicedNodes);

   //set up all nodes as paths -- we get fancy enclosing ones for groups
    if (d3.select("#region_overlay")) {
        //console.log("updating region overlay (updateSlices)");

        this.updateRegionView(bounds, viewSize, viewSizeChanged);

    }
};



SVGOverlay.prototype.onAdd = function () {
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.style.position = 'absolute';
    this.svg.style.top = '8px';
    this.svg.style.left = '8px';
    this.svg.style.width = '1100px';
    this.svg.style.height = '600px';
    this.svg.style.zIndex = 100;
    this.svg.style.pointerEvents = 'none';
    this.svg.id = "mapSVG"
    this.width = 1100;
    this.height = 600;


    d3.select(this.svg)
        .attr('width', 1100)
        .attr('height', 600);


    d3.select(this.svg)
        .append('g')
        .attr('id', 'region_overlay')
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
        .attr("width", 1100)
        .attr("height", 600);

    d3.select("#popoverLines")
        .attr("width", 1100)
        .attr('height', 600);

    d3.select("#canvasContainer")
        .attr('x_offset', 0)
        .attr('y_offset', 0);

    d3.select('#region_overlay').attr('class', 'coords');

    var projection = this.getProjection();


    this.popoverNodes = [];


    this.buildSlices();

    document.body.appendChild(this.svg);
    this.onPan();
    this.map.addListener('center_changed', this.onPan);
    this.map.addListener('zoom_changed', this.onZoomStarted);
    this.map.addListener('bounds_changed', this.onBoundsChanged);
    //this.map.addListener('mousemove', this.onMouseMove);
    this.map.addListener('click', this.onMouseClick);


    this.rebuildForceModel();

    LEAVES_ONSCREEN = LEAF_NODES;
    this.buildRankingSlider();


/*
//DEBUG TEST
    for (let i=0; i<4; i++) {
        let container = d3.select('#popoverContainer').append("div");
        this.buildPopover(LEAF_NODES[i], projection, container.node(), true);
    }*/

};


//move outlines during pan so they stay in frame
SVGOverlay.prototype.onBoundsChanged = function () {
    //console.log('***BOUNDS')

    if (this.recentlyZoomed) {
        this.recentlyZoomed=false;
        this.onZoomFinished();
    }

    //this.updateRegionView();
    this.updateLeavesOnscreen();

    let bounds = this.map.getBounds();
    this.updateSlices();
    this.updateForceModelWithNewBounds(bounds);
    this.updatePopoverObjectsFromForce(false, false);

    if (this.last_layout_bounds) {
        translateRegionView(this.last_layout_bounds, bounds);
        this.last_layout_bounds = bounds;
    }
    else {
        this.redrawRegionView(bounds);
    }

};


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
    //console.log(LEAVES_ONSCREEN);
    this.computeNewLeafRankings();
    this.updateRecommendedPopovers();

};

SVGOverlay.prototype.onZoomStarted = function () {
    console.log('***ZOOM   -----'+this.map.getZoom());

    this.recentlyZoomed = true;

};

//move outlines during pan so they stay in frame
SVGOverlay.prototype.onZoomFinished = function () {
    /*console.log('***ZOOM_DONE   -----'+this.map.getZoom());
    var t = this;
    setTimeout(function() {
    },1000);
    // */
    // clearExpansion();

    this.last_layout_bounds = null; //wipe past transform on popovers etc
    this.currentCanvasTiles = null;
    let projection = this.getProjection();
    let bounds = this.map.getBounds();
    //this.resetAllPopupPositions( projection );
    //this.layoutPopups( projection );

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

    console.log("draw_call");

};


SVGOverlay.prototype.clearPopovers = function () {
    d3.selectAll(".popover-wrapper").remove();
};



SVGOverlay.prototype.drawSingletons = function (single, bounds, viewSize, viewSizeChanged) {

    var projection = this.getProjection();
    var svg = d3.select("#region_overlay");


    svg.selectAll("circle.singleton").data(single).enter().append("circle")
        .attr("class", "datapoint singleton")
        .attr('r', 4);

    svg.selectAll("circle.singleton").data(single).exit().remove();

    svg.selectAll("circle.singleton").each( function (d,i) {
        let proj = d.getCenterDProj(LATVAL, LONVAL, projection);
        d3.select(this).attr('cx',proj[0])
                       .attr('cy',proj[1]);
    });
};

SVGOverlay.prototype.drawPaths = function (over, bounds, viewSize, viewSizeChanged) {

    var projection = this.getProjection();
    var svg = d3.select("#region_overlay");

    svg.selectAll("path.group").data(over).enter().append("path")
        .attr("class", "datapoint group")
        .attr('opacity', '0.6')
        .attr('fill', 'none')
        .attr('stroke', '#888')
        .attr('stroke-width', '3px');
        //.attr("d", function(d) {return d.getPathDProj(LATVAL, LONVAL, projection);});

    svg.selectAll("path.group").data(over).exit().remove();

    //if view size changed, update the path variable
    //if (viewSizeChanged) {
        //console.log("buildpaths");

        svg.selectAll("path.group")
            .attr("d", function(d) {return d.getPathDProj(LATVAL, LONVAL, projection);});
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




SVGOverlay.prototype.drawPathCanvases = function (tiles, bounds) {

    //might be faster to draw it all on one big canvas!
    //or use some kind of screen tiling system to queue up stuff that isn't quite onscreen

    //console.log("DRAW CANVAS")
    var projection = this.getProjection();
    var container = d3.select("#canvasContainer");
    let zoom = this.map.getZoom();


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
            console.log("redrawing tile");
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
        d3.select(this).style("transform", "translate("+parseInt(d.proj.x - d.overflow)+"px,"+parseInt(d.proj.y - d.overflow)+"px)")
                        .style("top", 0 + "px")
                       .style("left", 0+ "px");



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

SVGOverlay.prototype.drawQuantBins = function (over, bounds, viewSize, viewSizeChanged) {

    var projection = this.getProjection();
    var svg = d3.select("#region_overlay");
    let defs = d3.select('#path_defs');

    //clip paths to truncate drawing of density
    svg.selectAll("clipPath.groupClip").data(over).enter().append("clipPath")
        .attr("class", "groupClip")
        .append("path");

    svg.selectAll("clipPath.groupClip").data(over).exit().remove();

    svg.selectAll("clipPath.groupClip")
        .attr("id", function(d) {return "clip_"+d.id;})
        .select("path")
        .attr("d", function(d) {return d.getPathDProj(LATVAL, LONVAL, projection);});



    //density squares
    //var ratingScale = getScaleForDatatype(this.data, "rating", 1);

    let w = d3.select("#map").node().getBoundingClientRect().width;
    let h = d3.select("#map").node().getBoundingClientRect().height;

    svg.selectAll("g.quant").data(over).enter().insert("g", ":first-child")
       .attr("class", "quant");

    svg.selectAll("g.quant").data(over).exit().remove();

    svg.selectAll("g.quant")
        .attr("clip-path", function(d) {return 'url(#clip_'+d.id+')';})
        .each( function(d, i) {
        let g = d3.select(this);
        let t = quantizeNode(d,LATVAL,LONVAL, w, h, projection);
        let bins = t[0];
        let max = t[1];

        let avg = 0;
        for (let nn of d.data_rows) {
            avg = avg + d.data_src[nn]["rating"];
        }
        avg = avg / d.data_rows.length;
        //console.log(avg)

        g.selectAll("rect.bin").data(bins).enter().append("rect")
         .attr("class","bin")
         //.attr("fill", function(d) { return d3.interpolateBlues(((d.data_rows.length / max)*0.5) + 0.5); })
         //.attr("opacity", "0.2");
        .attr("fill", "#69D")
        .attr("opacity", function(d) { return 0.2 + 0.4 * (d.data_rows.length / max);  });

        g.selectAll("rect.bin").data(bins).exit().remove();

        g.selectAll('rect.bin').each( function(e,j) {
            d3.select(this).attr("x",e.x-e.size)
             .attr("y",e.y-e.size)
             .attr("width",e.size*2)
             .attr("height",e.size*2);

        });
    });

};

SVGOverlay.prototype.drawRecommended = function (recommended_nodes, bounds) {

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

    svg.selectAll("circle.recommended").each( function (d,i) {
        let latLng = new google.maps.LatLng(d.data_src[d.data_rows[0]][LATVAL], d.data_src[d.data_rows[0]][LONVAL]);
        let loc = projection.fromLatLngToContainerPixel(latLng);

        d3.select(this).attr('cx',loc.x)
                       .attr('cy',loc.y);
    });

};


























SVGOverlay.prototype.updateRegionView = function (bounds, viewSize, viewSizeChanged) {

    //agnostic to any zoom/pan level, just updates according to standard heuristics

    //mark circle elements for singletons
    var single = this.slicedNodes.filter(function(d) { return (d.data_rows.length < 2) &&
                                                              (d.isOnScreenPadded); });

    this.drawSingletons(single, bounds, viewSize, viewSizeChanged);

    //mark path elements for groups
    let over = this.slicedNodes.filter(function(d) { return (d.data_rows.length >= 2) &&
                                                            (d.isOnScreenPadded); });

    this.drawPaths(over, bounds, viewSize, viewSizeChanged);


    //labels for paths
    //this.drawPathLabels(over, bounds, viewSize, viewSizeChanged);


    //quantitative bins
    //CANCEL FOR NOW
    //this.drawQuantBins(over, bounds, viewSize, viewSizeChanged);


/*
    var svg = d3.select("#region_overlay");
        var projection = this.getProjection();
    var debugLayer = svg.selectAll("circle.debug")
                        .data(LEAF_NODES);
    debugLayer.enter().append("circle")
            .attr("class", "debug")
            .attr('fill', '#888')
            .attr('stroke', '#444')
            .attr('stroke-width', '1px')
            .attr('opacity', '0.5')
            .attr('r', 2);
    debugLayer.exit().remove();

    d3.select("#region_overlay").selectAll("circle.debug").each( function (d,i) {
        let proj = d.getCenterDProj(LATVAL, LONVAL, projection);
        d3.select(this).attr('cx',proj[0])
                       .attr('cy',proj[1]);
    });*/




};


SVGOverlay.prototype.redrawRegionView = function (bounds) {
    //console.log("redraw");
    //ought to move everything from update to redraw/translate for better performance
    //also need better cleaning/identifying things that are going to be onscreen


    //var single = this.slicedNodes.filter(function(d) { return (d.data_rows.length < 2) &&
    //                                                          (d.isOnScreen); });
    let over = this.slicedNodes.filter(function(d) { return (d.data_rows.length >= 2) &&
                                                            (d.isOnScreenPadded); });


    if (this.currentCanvasTiles) {
        let tiles = this.fetchOnlyOnscreenTilesAndRender(this.currentCanvasTiles, this.map.getBounds(), false, {});
        this.drawPathCanvases(tiles, bounds);
    }
    else {
        this.currentCanvasTiles = this.getCanvasTilesForClustersAtCurrentZoom(over);
        let tiles = this.fetchOnlyOnscreenTilesAndRender(this.currentCanvasTiles, this.map.getBounds(), false, {});
        this.drawPathCanvases(tiles, bounds);
    }

    //draw the canvases


};


SVGOverlay.prototype.translateRegionView = function (old_bounds, new_bounds) {

    //need to implement pass to check if need to render new items that have come onscreen

    console.log("translate");
    let projection = this.getProjection();
    let bounds = this.map.getBounds();

    let old_proj = projection.fromLatLngToContainerPixel(old_bounds.getSouthWest());
    let new_proj = projection.fromLatLngToContainerPixel(new_bounds.getSouthWest());

    let offset = {x: new_proj.x - old_proj.x, y: new_proj.y - old_proj.y};


    //just move around the recommended circle
    this.repositionRecommended(bounds);


    if (this.currentCanvasTiles) {
        let tiles = fetchOnlyOnscreenTilesAndRender(this.currentCanvasTiles, this.map.bounds, false, {});
        this.drawPathCanvases(tiles, bounds);
    }
    else {
        this.currentCanvasTiles = getCanvasTilesForClustersAtCurrentZoom(over);
        let tiles = fetchOnlyOnscreenTilesAndRender(this.currentCanvasTiles, this.map.bounds, false, {});
        this.drawPathCanvases(tiles, bounds);
    }



}


SVGOverlay.prototype.onMouseClick = function (e) {








    let projection = this.getProjection();
    let loc = projection.fromLatLngToContainerPixel(e.latLng);
    console.log(e.latLng.lat(),e.latLng.lng());
    let x = Math.round(Math.abs(loc.x));
    let y= Math.round(Math.abs(loc.y));

    let scores = scoreNodes(DATASET, this.slicedNodes);

    rankLeaves(LEAF_NODES, this.map.getBounds());

    d3.selectAll("path.group").each(function(d,i) {


        if (d.checkContainment(LATVAL,LONVAL,[e.latLng.lat(),e.latLng.lng()])) {



            console.log(clusterStats(d));


            let lst = d3.select("#datadump").html("").append("ul");
            let score = RAW_SCORES;

            //console.log(score);
            for (let col of VALID_NUM_COLUMNS) {
                lst.append("li").text(col+": M"+score.means[d.id][col]+" E"+score.errors[d.id][col]);
            }
            for (let col of VALID_NOM_COLUMNS) {
                for (let term in score.tfidf[d.id][col]) {
                    if (score.tfidf[d.id][col][term] > 0.1) {
                        lst.append("li").text(term+": "+score.tfidf[d.id][col][term]);
                    }
                }
            }


        }


    });



};










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
var repelForce = d3.forceManyBody().strength(function(d) {return d.type == "pop" ? -0.01 : -0.005;});
var linkForce = d3.forceLink().iterations(3);
var centerForce = d3.forceCenter();
var boundingForce = boundedBox().size(function (d) { return [d.width, d.height]; });
var collideForce = rectCollide().strength(1).iterations(5).size(function (d) { return [d.width, d.height]; });
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

    repelForce.theta(0.001)
                .distanceMax(latDist*0.3);

    centerForce.x((lonMax+lonMin) / 2.0)
               .y((latMax+latMin) / 2.0);

    linkForce.distance(latDist*0.2);

    boundingForce.bounds([[lonMin+lonPad, latMin+latPadBot], [lonMax-lonPad, latMax-latPad]]);

    xForce.x(function(d) {return d.type == "pop" ? d.l_x + (d.go_left ? -lonDist*0.2 : lonDist*0.2) : 0;});
    yForce.y(function(d) {return d.type == "pop" ? d.l_y + latDist*0.2: 0;});

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
    console.log("REBUILD FORCE")

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
    p1 = point2LatLng(0,0,projection,bounds,zoom);
    p2 = point2LatLng(210,85,projection,bounds,zoom);
    let pop_width = Math.abs(p2.lng() - p1.lng());
    let pop_height = Math.abs(p2.lat() - p1.lat());

    let i;
    force_nodes = [];
    force_links = [];
    //make fixed nodes for popup sources and nodes for popuprects
    i=this.popoverNodes.length-1;
    while (i>=0) {
        let node = this.popoverNodes[i];
        let centroid = node.getHullCentroid(LATVAL, LONVAL);
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
                    x : centroid[1] - pop_width/2.0 + Math.random()*0.01-0.005,
                    y : centroid[0] - pop_height/2.0 + Math.random()*0.01-0.005,
                    width : pop_width,
                    height : pop_height,
                    l_x : centroid[1]-circle_width,
                    l_y : centroid[0]-circle_width,
                    fixed : true,
                    go_left : Math.random() > 0.5,
                    node_id : node.id,
                    node_ref : node};
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
                     //.force("boundingForce",boundingForce)
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
    console.log("iterate");

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
        while(iters < 10) {
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
    p1 = point2LatLng(0,0,projection,bounds,zoom);
    p2 = point2LatLng(210,85,projection,bounds,zoom);
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
                x : centroid[1] - pop_width/2.0 + Math.random()*0.01-0.005,
                y : centroid[0] - pop_height/2.0 + Math.random()*0.01-0.005,
                width : pop_width,
                height : pop_height,
                l_x : centroid[1]-circle_width,
                l_y : centroid[0]-circle_width,
                fixed : true,
                go_left : Math.random() > 0.5,
                node_id : popNode.id,
                node_ref : popNode};
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
    let pop = force_nodes.filter(function(d) {return d.type == "pop";});
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
                .attr("stroke", "rgba(30, 80, 120, 0.9)")
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
        let screenwidth = $(this).parent().attr("width");
        let screenheight = $(this).parent().attr("height");

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

        d3.select(this).attr("x1", source2d.x - 8)
                       .attr("y1", source2d.y - 8);
        if (animateMove) { //marker if popover never placed before
            $(this).attr({x2 : old_targetX, y2 : old_targetY})
                   .velocity({x2 : targetX, y2 : targetY}, 500, "swing");

        }
        else {
            d3.select(this).attr("x2", targetX)
                           .attr("y2", targetY);
        }



        d3.select(this).attr("placed","t");

    });




    //this.DEBUGupdatePopoverObjectsFromForce();

};

/*
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



};*/



SVGOverlay.prototype.forceTick = function () {
    //triggered every tick. converts from lat/lng into screenspace and updates position
    //this should take care of scrolling issues more gracefully
    this.updatePopoverObjectsFromForce(false, false);

};




















var LEAF_RANKINGS = [];
var SHOW_NODES = [];

SVGOverlay.prototype.buildRankingSlider = function ( ) {

    $("#rankingSlider").rangeSlider({
        range: {min:5,max:5},
        step: 1,
        defaultValues: {min:1,max:5}

    });
    $("#rankingSlider").bind("valuesChanging", this.rankingSliderChanged.bind(this));

    this.computeNewLeafRankings();
    this.updateRecommendedPopovers();

};


SVGOverlay.prototype.computeNewLeafRankings = function ( ) {

    let bounds = this.map.getBounds();

    //boundsupdate should keep LEAVES_ONSCREEN going
    LEAF_RANKINGS = rankLeaves(LEAVES_ONSCREEN, bounds);
    //console.log(LEAF_RANKINGS);
    $("#rankingSlider").rangeSlider("bounds", 1, LEAF_RANKINGS.length);

    SHOW_NODES = [];
    for (let i=$("#rankingSlider").rangeSlider('min')-1;
             i<$("#rankingSlider").rangeSlider('max')-1;
             i++) {
         SHOW_NODES.push(LEAF_RANKINGS[i]);
     }

};

SVGOverlay.prototype.updateRecommendedPopovers = function () {
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
    this.drawRecommended(SHOW_NODES, this.map.getBounds());

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
    //MODIFY THE FORCE MODEL AS NEED BE
};

SVGOverlay.prototype.rankingSliderChanged = function (e, data) {

    console.log("Values just changed. min: " + data.values.min + " max: " + data.values.max);

    this.computeNewLeafRankings();
    this.updateRecommendedPopovers();

};







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
    headerContainer.select('.ratings').append("span").append("img")
        .attr("src", ratingImg);

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
            let offsetX = $('#mapSVG').attr("width") - $popoverContainer.position().left
                                               - $(headerContainer.node()).width()
                                               - $snip.outerWidth()
                                               - 15; //pad
            let offsetY = $('#mapSVG').attr("height") - $popoverContainer.position().top
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
    headerContainer.select('div.ratings img').attr("src", ratingImg);

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
    $(snippetsLabel.node()).unbind('click').click(function () {
        //console.log(parseInt($snip.css("margin-top")));
        if (parseInt($snip.css("margin-top")) < -1) {
            $label.text("-");
            //shift the whole container up if we would go below bottom of screen
            let offsetX = $('#mapSVG').attr("width") - $popoverContainer.position().left
                                               - $(headerContainer.node()).width()
                                               - $snip.outerWidth()
                                               - 15; //pad
            let offsetY = $('#mapSVG').attr("height") - $popoverContainer.position().top
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




var CIRCLE_SIZE = 3;
var BOX_SIZE = 3; //(usually 2x circle radius)
var TILE_SIZE = 400; //px

SVGOverlay.prototype.fetchOnlyOnscreenTilesAndRender = function (tiles, screenBounds, forceRender, renderParams) {

    //console.log("RENDER")
    //console.log(tiles)

    let width = d3.select(this.svg).attr('width');
    let height = d3.select(this.svg).attr('height');
    let projection = this.getProjection();

    let latMin = screenBounds.getSouthWest().lat();
    let latMax = screenBounds.getNorthEast().lat();
    let lonMin = screenBounds.getSouthWest().lng();
    let lonMax = screenBounds.getNorthEast().lng();

    function isPartiallyInBounds(x, y) {
        if ((x >= 0) && (x <= width) &&
           (y >= 0) && (y <= height)) {
            return true;
           }
        else {
            return false;
        }
    }

    let tile_sort = {};

    let i=tiles.length-1;
    while (i>=0) {
        let tile = tiles[i];

        let latLng = new google.maps.LatLng(tile.upperLeft.lat, tile.upperLeft.lon);
        let proj = projection.fromLatLngToContainerPixel(latLng);

        if (isPartiallyInBounds(proj.x, proj.y) ||
            isPartiallyInBounds(proj.x+TILE_SIZE, proj.y) ||
            isPartiallyInBounds(proj.x, proj.y+TILE_SIZE) ||
            isPartiallyInBounds(proj.x+TILE_SIZE, proj.y+TILE_SIZE)) {

            tile.proj = proj;

            if (!(tile.x in tile_sort)) {
                tile_sort[tile.x] = {};
            }

            if (!(tile.y in tile_sort[tile.x])) {
                tile_sort[tile.x][tile.y] = tile;
                tile_sort[tile.x][tile.y].node_id = [parseInt(tile_sort[tile.x][tile.y].node_id)];
                tile_sort[tile.x][tile.y].node_sum = parseInt(tile_sort[tile.x][tile.y].node_id);
            }
            else {
                let k=tile.circles.length-1;
                tile_sort[tile.x][tile.y].node_sum += parseInt(tile.node_id);
                tile_sort[tile.x][tile.y].node_id.push(tile.node_id);
                while (k>=0) {
                    tile_sort[tile.x][tile.y].circles.push(tile.circles[k]);
                    k--;
                }
            }


        }
        i--;


    }


    let final_tiles = [];
    for (let x_ind in tile_sort) {
        for (let y_ind in tile_sort[x_ind]) {
            final_tiles.push(tile_sort[x_ind][y_ind]);
            this.renderTile(tile_sort[x_ind][y_ind], forceRender, renderParams);
        }
    }

    return final_tiles;


};


SVGOverlay.prototype.renderTile = function (tile, forceRender, renderParams) {

    let colorForNode = function (n) {
        let v = DESC_STATS['rating'].scale(DATASET[n]['rating']);
        if (v < 0.5) {
            return d3.interpolateLab("#d8342c","#f2f2f2","#4a76b5")(v*2.0);
        }
        else {
            return d3.interpolateLab("#f2f2f2","#4a76b5")((v-0.5)*2.0);
        }
    };

    if (!('canvas' in tile) || forceRender) {

        let offscreenCanvas = document.createElement('canvas');
        //create offscreen draw, note padding by circle size in case on edges
        offscreenCanvas.width = TILE_SIZE+(tile.overflow*2);
        offscreenCanvas.height = TILE_SIZE+(tile.overflow*2);

        let ctx=offscreenCanvas.getContext("2d");

        let j=tile.circles.length-1;
        while (j>=0) {
            let c=tile.circles[j];
            ctx.fillStyle = colorForNode(c.data_row);
            ctx.beginPath();
            ctx.arc(Math.floor(c.ox+tile.overflow),Math.floor(c.oy+tile.overflow),CIRCLE_SIZE,0,2*Math.PI);
            ctx.stroke();
            ctx.fill();

            j--;
        }

        tile['canvas'] = ctx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);


    }


};





SVGOverlay.prototype.getCanvasTilesForClustersAtCurrentZoom = function (nodes) {

    //takes in a list of nodes; for a given zoom level, either pulls from cache or sims circles
    // sorts the resulting circles into standard tiles
    //returns a complete set of (overlapping) tiles for all nodes in the list regardless of onscreen

    let projection = this.map.getProjection();
    let projectionScreen = this.getProjection();
    let bounds = this.map.getBounds();
    let zoom = this.map.getZoom();

    var p = point2LatLng(TILE_SIZE,TILE_SIZE,projection,bounds,zoom);
    this.TILE_LAT = p.lat();
    this.TILE_LON = p.lng();
    console.log(p);

    //composit any new tilesets for given nodes
    let i = nodes.length - 1;
    while (i>=0) {
        let node = nodes[i];

        if (!(zoom in this.CANVAS_TILE_DB)) {
            this.CANVAS_TILE_DB[zoom] = {};
        }
        if (!(node.id in this.CANVAS_TILE_DB[zoom])) {
            let bins = forceNodesForCluster(nodes[i], projectionScreen);

            let sim = simulateWithBins(bins);

            let node_tile_map = {};

            let j=sim.c.length-1;
            while (j>=0) {
                //sort them into tiles
                let circle = sim.c[j];
                circle['cluster'] = node;

                let x_ind = Math.floor(circle.x / TILE_SIZE);
                let y_ind = Math.floor(circle.y / TILE_SIZE);
                let corner = point2LatLng(x_ind*TILE_SIZE,y_ind*TILE_SIZE,projection,bounds,zoom);
                let corner2 = point2LatLng((x_ind-1)*TILE_SIZE,(y_ind+1)*TILE_SIZE,projection,bounds,zoom);

                if (!(zoom in node_tile_map)) {
                    node_tile_map[zoom] = {};
                }
                if (!(x_ind in node_tile_map[zoom])) {
                    node_tile_map[zoom][x_ind] = {};
                }
                if (!(y_ind in node_tile_map[zoom][x_ind])) {
                    let tile = { x: x_ind, //x,y,zoom make up unique identifier for tile
                                 y: y_ind,
                                 zoom: zoom,
                                 node_id: node.id,
                                 upperLeft: {   x: x_ind*TILE_SIZE,
                                                y: y_ind*TILE_SIZE,
                                                lat: corner.lat(),
                                                lon: corner.lng()},
                                 lowerRight: {  x: (x_ind+1)*TILE_SIZE,
                                                y: (y_ind+1)*TILE_SIZE,
                                                lat: corner2.lat(),
                                                lon: corner2.lng()},
                                 tile_sz: TILE_SIZE,
                                 overflow: CIRCLE_SIZE,
                                 circles: []
                             };

                    node_tile_map[zoom][x_ind][y_ind] = tile;
                }

                //create offset positions for the circles
                circle['ox'] = circle.x - (x_ind*TILE_SIZE);
                circle['oy'] = circle.y - (y_ind*TILE_SIZE);

                node_tile_map[zoom][x_ind][y_ind].circles.push(circle);

                j--;
            }

            this.CANVAS_TILE_DB[zoom][node.id] = node_tile_map;

        }


        i--;
    }

    let all_tiles = [];
    i = nodes.length - 1;
    while (i>=0) {
        let node = nodes[i];
        let node_tile_map = this.CANVAS_TILE_DB[zoom][node.id];

        for (let x_ind in node_tile_map[zoom]) {
            for (let y_ind in node_tile_map[zoom][x_ind]) {
                /*if (!(x_ind in all_tiles_map)) {
                    all_tiles_map[x_ind] = {};
                }
                if (!(y_ind in all_tiles_map[x_ind])) {
                    all_tiles_map[x_ind][y_ind] = [];
                }

                all_tiles_map[x_ind][y_ind].push(node_tile_map[zoom][x_ind][y_ind]);*/
                all_tiles.push(node_tile_map[zoom][x_ind][y_ind]);

            }
        }
        i--;
    }

    return all_tiles;
};




function createCanvasForCluster(node, containerElement, projection) {



    let bins = forceNodesForCluster(node, projection);

    let sim = simulateWithBins(bins);

    let canvas = d3.select(containerElement)
                    .style("position", "absolute")
                    .style("left", (sim.offset.x-8)+"px")
                    .style("top", (sim.offset.y-8)+"px")
                    .append("canvas")
                    .attr('width', sim.width)
                    .attr('height', sim.height);

    drawForceCirclesOnto(sim.c, canvas.node(), sim.offset);

}




function forceNodesForCluster(node, projection) {

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
            y: proj.y,
            dy: proj.y,
            data_row: n
        });

        i--;
    }

    return bins;

}

function simulateWithBins(bins) { //add heuristic here to pick correct bins

    let circles = [];
    let x_min = Number.MAX_VALUE;
    let x_max = Number.MIN_VALUE;
    let y_min = Number.MAX_VALUE;
    let y_max = Number.MIN_VALUE;
    for (let x in bins) {
        for (let y in bins[x]) {

            //take off the top for now
            let n = bins[x][y].pop();
            //n['r'] = CIRCLE_SIZE;

            x_min = Math.min(x_min, n.x);
            x_max = Math.max(x_max, n.x);
            y_min = Math.min(y_min, n.y);
            y_max = Math.max(y_max, n.y);

            circles.push(n);

        }
    }


    let model = d3.forceSimulation()
                     //.alphaDecay(0.1)
                     //.force("fx",d3.forceX(function(d) {return(d.dx);}).strength(0.05))
                     //.force("fy",d3.forceY(function(d) {return(d.dy);}).strength(0.05))
                     .force("collideForce",d3.forceCollide(function() {return CIRCLE_SIZE;}).strength(1).iterations(5))
                     .nodes(circles)
                     .stop();

    let iters = 0;
    while(iters < 10) {
        model.tick();
        iters++;
    }
    model.stop();

    return {c: circles,
            offset: {x: x_min-8, y: y_min-8},
            width: x_max-x_min+16,
            height: y_max-y_min+16};

}

function drawForceCirclesOnto(circles, canvas, offset) {

    let i=circles.length-1;
    while (i>=0) {
        let c=circles[i];
        let ctx=canvas.getContext("2d");
        ctx.beginPath();
        ctx.arc(parseInt(c.x-offset.x),parseInt(c.y-offset.y),CIRCLE_SIZE,0,2*Math.PI);
        ctx.stroke();

        i--;
    }


}















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


    //gather initial stats
    gatherStats(LEAF_NODES);










    /*
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
    */








  //BUILD THE MAP ITSELF
  var map = new google.maps.Map(el, {
    disableDefaultUI: true,
    backgroundColor: '#FFFFFF'
  });

  map.fitBounds(BOUNDS);


  fetch('mapstyles.json')
    .then((response) => response.json())
    .then(function (styles) {
      map.mapTypes.set('neutral', new google.maps.StyledMapType(styles));
      map.setMapTypeId('neutral');
    });

 OVERLAY= new SVGOverlay(map, data);









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
