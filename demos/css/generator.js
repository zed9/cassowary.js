/**
 * Copyright (C) 2012, Alex Russell (slightlyoff@chromium.org)
 * Use of this source code is governed by the LGPL, which can be found in the
 * COPYING.LGPL file.
 */

(function(scope) {
"use strict";

//////////////////////////////////////////////////////
//  Utility functions
//////////////////////////////////////////////////////

var global = function(id) {
  return scope.document.getElementById(id).contentWindow;
};
var doc = function(id) { return global(id).document; };

var weak = c.Strength.weak;
var medium = c.Strength.medium;
var strong = c.Strength.strong;
var required = c.Strength.required;

var eq  = function(a1, a2, strength, w) {
  return new c.LinearEquation(a1, a2, strength || weak, w||0);
};
var neq = function(a1, a2, a3) { return new c.LinearInequality(a1, a2, a3); };
var geq = function(a1, a2, str, w) { return new c.LinearInequality(a1, c.GEQ, a2, str, w); };
var leq = function(a1, a2, str, w) { return new c.LinearInequality(a1, c.LEQ, a2, str, w); };

var stay = function(v, strength, weight) { 
  return new c.StayConstraint(v, strength || weak, weight || 1.0);
};
var weakStay =   function(v, w) { return stay(v, weak, w); };
var mediumStay =   function(v, w) { return stay(v, medium, w); };
var strongStay =   function(v, w) { return stay(v, strong, w); };
var requiredStay = function(v, w) { return stay(v, required, w); };

var CSSValue = c.inherit({
  initialize: function(value, name) {
    this.value = value;
    this.name = name;
  },
  get px() {
    //console.log(this.name, ":", this.value, parseFloat(this.value));
    if (this.value == "auto") {
      // console.warn("providing 0 for auto on:", this.name);
      return 0;
    } else if (this.value.indexOf("px") >= 0) {
      return parseFloat(this.value);
    } else {
      console.warn("wrong px version of:", this.name, ":", this.value);
      // FIXME(slightlyoff):
      //      Convert to absolute pixels, taking into account current element
      //      EM/EN sizing, etc.
      return parseFloat(this.value);
    }
  },
  get pct() { return parseFloat(this.value); },
  get str() { return this.value; },
  get raw() { return this.value; },
  toString: function() { return this.value; },
  get isAuto() { return this.value == "auto"; },
  get isPct() { return this.value.indexOf("%") >= 0; },
});

//  getComputedStyle returns USED width/height/etc. (post-layout) in the
//  original document, not the COMPUTED width/height/etc. This defeats our
//  engine entirely. To avoid writing a parser and resolver, we require
//  (for now) that all the following styles be declared *on the elements
//  themselves* or on simple in-document ID rules:
//    background-position
//    bottom, left, right, top
//    height, width
//    margin-bottom, margin-left, margin-right, margin-top,
//    min-height, min-width
//    padding-bottom, padding-left, padding-right, padding-top
//    text-indent
//  
//  This means that we effectively only support these styles when written as:
//
//    <style>
//        #thinger {
//            left: 100px;
//            ...
//        }
//    </style>
//    <div id="thinger" style="width: 500px; height 500px;">...</div>
//  
//  See also:
//      https://developer.mozilla.org/en/DOM/window.getComputedStyle
//      https://developer.mozilla.org/en/CSS/used_value
//      https://developer.mozilla.org/en/CSS/computed_value
var _localCssProperties = [
  "background-position",
  "bottom", "left", "right", "top",
  "height", "width", "min-height", "min-width",
  "margin-bottom", "margin-left", "margin-right", "margin-top",
  "padding-bottom", "padding-left", "padding-right", "padding-top",
  "text-indent"
];
var css = function(propertyName, node) {
  var value;
  if (!node && this.node) {
    node = this.node;
  }
  node = (node.nodeType == 1) ? node : node.parentNode;
  if (_localCssProperties.indexOf(propertyName) >= 0) {
    // We don't trust getComputedStyle since it returns used values for these
    // properties, so we instead look to see what the node itself has
    // specified.
    value = node.style[toCamelCase(propertyName)];


    // If we don't get something from the node, we try to honour ID-targeted
    // rules. We're not looking to understand "!important", settle ordering
    // issues, handle linked sheets, etc. This is purely a hack.
    if (!value) {
      // FIXME: expensive, cache!
      value = "auto";
      var id = node.id;
      if (id) {
        var idRe = new RegExp("\#"+id+"\\s*{");
        toArray(node.ownerDocument.styleSheets).forEach(function(sheetList) {
          toArray(sheetList).forEach(function(sheet) {
            toArray(sheet.cssRules).forEach(function(rule) {
              if (rule.type == 1) {
                if (rule.cssText.search(idRe) == 0) {
                  var tv = rule.style[toCamelCase(propertyName)];
                  if (tv) {
                    value = tv;
                  }
                }
              }
            });
          });
        });
      }
    }
  } else {
    value = node.ownerDocument.defaultView.getComputedStyle(node).getPropertyValue(propertyName);
  }
  return new CSSValue(value, propertyName);
};

var isElement = function(n) {
  return n && n.nodeType == 1;
};

var isBlock = function(n) {
  if (!isElement(n)) return false;
  return (
    css("display", n).raw == "block" ||
    css("display", n).raw == "list-item" ||
    css("display", n).raw.indexOf("table") == 0
  );
};

var isInline = function(n) {
  if (!isElement(n)) return false;
  return (
    css("display", n).raw == "inline" ||
    css("display", n).raw == "inline-block" ||
    css("display", n).raw == "inline-table" ||
    css("display", n).raw == "ruby"
  );
};

var isFixed = function(n) {
  if (!isElement(n)) return false;
  return (css("position", n).raw == "fixed");
};

var isPositioned = function(n) {
  // TODO(slightlyoff): should floated elements be counted as positioned here?
  if (!isElement(n)) return false;
  return (
    css("position", n).raw == "fixed" ||
    css("position", n).raw == "absolute" ||
    css("position", n).raw == "center" ||
    css("position", n).raw == "page" // TODO(slightlyoff)
  );
};

var isFlowRoot = function(n) {
  if (!isElement(n)) return false;
  return (
    css("float", n).raw != "none" ||
    css("overflow", n).raw != "visible" || // FIXME: need to get USED value!
    css("display", n).raw == "table-cell" ||
    css("display", n).raw == "table-caption" ||
    css("display", n).raw == "inline-block" ||
    css("display", n).raw == "inline-table" ||
    (
      css("position", n).raw != "static" &&
      css("position", n).raw != "relative"
    )
    // FIXME:
    //      Need to account for "block-progression" here, but WebKit
    //      doesn't support it yet, so it's not accessible through the DOM.
  );
};

var isInFlow = function(n) {
  if (!isElement(n)) return false;
  return (
    ( // FIXME: need to get USED values here!
      css("display", n).raw == "block" ||
      css("display", n).raw == "list-item" ||
      css("display", n).raw == "table"
    ) &&
    css("float", n).raw == "none" &&
    (
      css("position", n).raw == "static" ||
      css("position", n).raw == "relative"
    )
    // FIXME:
    //  "4. It is either a child of the flow root or a child of a box that
    //  belogs to the flow."
  );
};

var isRunIn = function(n){
  // TODO(slightlyoff)
  return false;
};

var DEFULT_MEDIUM_WIDTH = 3;

//////////////////////////////////////////////////////
//  Types
//////////////////////////////////////////////////////

var MeasuredBox = c.inherit({
  initialize: function(top, left, right, bottom) {
    this.top =    top||0;
    this.left =   left||0;
    this.right =  right||0;
    this.bottom = bottom||0;
  },
  get width() { return this.right - this.left; },
  get height() { return this.bottom - this.top; },
});

var Box = c.inherit({
  initialize: function(top, left, right, bottom) {
    this._top =    new c.Variable(top||0);
    this._left =   new c.Variable(left||0);
    this._right =  new c.Variable(right||0);
    this._bottom = new c.Variable(bottom||0);
  },
  get top()    { return this._top.value(); },
  get left()   { return this._left.value(); },
  get right()  { return this._right.value(); },
  get bottom() { return this._bottom.value(); },
  get width()  { return this.right - this.left; },
  get height() { return this.bottom - this.top; },

  // FIXME(slightlyoff): need setters to over-ride the values for debugging!
});

var Edgy = function() {
  this.edges = {
    ref: {
      margin:   new Box(),
      border:   new Box(),
      padding:  new Box(),
      content:  new Box(),
    },
    actual: {
      margin:   new Box(),
      border:   new Box(),
      padding:  new Box(),
      content:  new Box(),
    },
  };

  // TODO(slightlyoff): support box-sizing by breaking these
  //                    assumptions!
  this.edges.ref.outer = this.edges.ref.margin;
  this.edges.ref.inner = this.edges.ref.content;

  this.edges.actual.outer = this.edges.actual.margin;
  this.edges.actual.inner = this.edges.actual.content;
};

var VarHeavy = function(properties) {
  this.values = {};
  this.vars = {};
  this.value = function(p, v) {
    var pn = toCamelCase(p);
    var val = this.values[pn];
    if (typeof v != "undefined") {
      if (!val) {
        val = this.values[pn] = new CSSValue(p, v);
      } else {
        val.value = v;
      }
    }
    return val;
  };
  this.var = function(p, v) {
    var pn = toCamelCase(p);
    var varv = this.vars[pn];
    if (typeof v != "undefined") {
      if (!varv) {
        varv = this.vars[pn] = new c.Variable(p, v);
      } else {
        varv._value = v;
      }
    }
    return varv;
  };
  properties.forEach(function(p) {
    this.value(p, "auto");
    this.var(p, p)
  }, this);
};

var Nodey = function(node, properties) {
  this.node = this.node || node;
  this.css = css;

  properties.forEach(function(p) {
    this.values[toCamelCase(p)] = css(p, this.node);
  }, this);
};

// FlowRoot mixin.
var FlowRoot = function() {
  this.blockProgression = "tb";
  this._isFlowRoot = true;
  this._flowBoxes = [];
  this.addFlowBox = function(b) {
    b.flowRoot = this;
    this._flowBoxes.push(b);
  };
  this.flow = function() {
    // 
    // "So here we go now
    //  Holla if ya hear me though
    //  Come and feel me, flow" -- NBN
    // 
 
    // console.log("flowing in:", this.node);

    if (!this._flowBoxes.length) { return; }

    var ref = this.edges.ref;
    var actual = this.edges.actual;
    var containing = actual;
    var solver = this.solver;
    var constrain = solver.add.bind(solver);

    var last;

    this._flowBoxes.forEach(function(child) {

      if (!isInFlow(child.node) && !(child instanceof AnonymousBlock)) {
        console.warn("not in flow!: " + child);
        return;
      }

      switch(this.blockProgression) {
        case "tb":
          // Left and right edges of our block children are our content
          // left/right.
          constrain(
            eq(child.edges.ref.margin._left, containing.content._left, strong),
            eq(child.edges.ref.margin._right, containing.content._right, strong)
          );

          // Next, top is the previous bottom, else containing's content top;
          if (last) {
            constrain(
              eq(child.edges.ref.margin._top, last.edges.ref.margin._bottom, strong)
            );
          } else {
            constrain(
              eq(child.edges.ref.margin._top, containing.content._top, strong)
            );
          }
          last = child;

          // TODO(slightlyoff): margin collapsing!
          break;
        case "rl": // TODO(slightlyoff)
        case "bt": // TODO(slightlyoff)
        case "lr": // TODO(slightlyoff)
        default:
          console.warn("Unsupported block-progression:",
                       this.blockProgression);
          break;
      }
      console.log("flowing: " + child);
    }, this);
  };
};

var RenderBox = c.inherit({
  initialize: function(node, containingBlock){
    Edgy.call(this);
    VarHeavy.call(this, this.boxProperties);
    if (node) {
      Nodey.call(this, node, this.boxProperties);
    }
    this.containingBlock = containingBlock;
 
    this.vars.mediumWidth = new c.Variable("mediumWidth", DEFULT_MEDIUM_WIDTH);
    this.naturalSize = contentSize(node);
    this.solver = this.solver || this.containingBlock.solver;

    if (isFlowRoot(node)) {
      FlowRoot.call(this);
    }
  },

  _className: "RenderBox",

  toString: function() {
    var m = this.edges.actual.margin;
    return this._className + ": { top: " + m.top +
                               ", right: " + m.right +
                               ", bottom:" + m.bottom +
                               ", left:" + m.left + " }";
  },

  boxProperties: [
    "position",
    "width", "min-width", "min-height",
    "height", "max-width", "max-height",
    "left", "right", "top", "bottom",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "margin-top-width",
    "margin-right-width",
    "margin-bottom-width",
    "margin-left-width",
    "border-top",
    "border-right",
    "border-bottom",
    "border-left",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "border-top-style",
    "border-right-style",
    "border-bottom-style",
    "border-left-style",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "padding-top-width",
    "padding-right-width",
    "padding-bottom-width",
    "padding-left-width",
  ],

  generate: function() {
    // Constraints for all boxes
    var ref = this.edges.ref;
    var actual = this.edges.actual;
    var solver = this.solver;
    var containing = this.containingBlock.edges.actual;
    var constrain = solver.add.bind(solver);
    var vals = this.values;
    var vars = this.vars;

    // FIXME(slightlyoff):
    //      Need to generate different rules for %-based values!

    // Michalowski '98, Section 3.1
    
    var _mediumWidth = new c.Variable("mediumWidth", DEFULT_MEDIUM_WIDTH);

    constrain(
      eq(c.Minus(ref.content._top, vals.paddingTop.px),
        ref.padding._top,
        required
      ),
      eq(c.Minus(ref.content._left, vals.paddingLeft.px),
        ref.padding._left,
        required
      ),
      eq(c.Plus(ref.content._right,  vals.paddingRight.px),
        ref.padding._right,
        required
      ),
      eq(c.Plus(ref.content._bottom, vals.paddingBottom.px),
        ref.padding._bottom,
        required
      )
    );

    constrain(
      eq(c.Minus(ref.padding._top, vals.borderTopWidth.px),
        ref.border._top,
        required
      ),
      eq(c.Minus(ref.padding._left, vals.borderLeftWidth.px),
        ref.border._left,
        required
      ),
      eq(c.Plus(ref.padding._right, vals.borderRightWidth.px),
        ref.border._right,
        required
      ),
      eq(c.Plus(ref.padding._bottom, vals.borderBottomWidth.px),
        ref.border._bottom,
        required
      )
    );

    constrain(
      eq(c.Minus(ref.border._top, vals.marginTop.px),
        ref.margin._top,
        required
      ),
      eq(c.Minus(ref.border._left, vals.marginLeft.px),
        ref.margin._left,
        required
      ),
      eq(c.Plus(ref.border._right, vals.marginRight.px),
        ref.margin._right,
        required
      ),
      eq(c.Plus(ref.border._bottom, vals.marginBottom.px),
        ref.margin._bottom,
        required
      )
    );

    // FIXME: if %-valued, need to do the obvious thing
    if (!vals.width.isAuto) {
      constrain(
        eq(c.Plus(ref.content._left, this.value("width").px),
          ref.content._right,
          required
        )
      );
    }

    if (!vals.height.isAuto) {
      constrain(
        eq(c.Plus(ref.content._top, this.value("height").px),
          ref.content._bottom,
          required
        )
      );
    }

    // Width and height are the result of:
    //  w = right - left;
    //  h = bottom - top;
    constrain(
      eq(c.Minus(ref.border._right, ref.border._left),
        vars.width,
        required
      ),
      eq(c.Minus(ref.border._bottom, ref.border._top),
        vars.height,
        required
      )
    );

    constrain(eq(this.var("width"), this.naturalSize.width, medium));

    if (!vals.width.isAuto) {
      constrain(eq(vars.width, vals.width.px, strong));
    }

    constrain(eq(vars.height, this.naturalSize.height, medium));

    if (!vals.height.isAuto) {
      constrain(eq(vars.height, vals.height.px, strong));
    }

    [
      vars.marginTop,
      vars.marginRight,
      vars.marginBottom,
      vars.marginLeft,
      vars.paddingTop,
      vars.paddingRight,
      vars.paddingBottom,
      vars.paddingLeft
    ].forEach(function(v) { constrain(eq(v, 0, weak)); });

    [
      vars.borderTop,
      vars.borderRight,
      vars.borderBottom,
      vars.borderLeft
    ].forEach(function(v) { constrain(eq(v, _mediumWidth, weak)); }); 


    ["margin", "border", "padding", "content"].forEach(function(type) {
      ["_left", "_top", "_right", "_bottom"].forEach(function(name) {
        // FIXME(slightlyoff): unsure how to make ref's variables read-only here!
        constrain(
          eq(actual[type][name], ref[type][name], strong)
        );
      });
    });

    constrain(
      geq(vars.width, 0, required),
      geq(vars.height, 0, required)
    );

    // RENDER DEBUGGING ONLY:
    /*
    constrain(
      eq(vars.minWidth, 10, strong),
      eq(vars.minHeight, 30, strong)
    );
    */

    constrain(
      geq(vars.width, vars.minWidth, required),
      geq(vars.height, vars.minHeight, required)
    );

    constrain(
      eq(vars.left, 0, weak),
      eq(vars.right, 0, weak),
      eq(vars.top, 0, weak),
      eq(vars.bottom, 0, weak)
    );

    // FIXME(slightlyoff):
    //  Missing 9.5 items for floated boxes

    // Michalowski '98, Section 3.3
    // Normally-positioned Block boxes
    //
    // TODO(slightlyoff)
    //
    
    // Michalowski '98, Section 3.4
    // Position-based Constraints
    //
    // TODO(slightlyoff)
    //
    var pos = vals.position;
    // console.log("pos:", pos+" {", vals.top+"", vals.right+"", vals.bottom+"", vals.left+" }");
    if (pos == "relative") {
      if (!vals.top.isAuto) {
        constrain(
          eq(actual.margin._top,
            c.Plus(ref.margin._top, vals.top.px),
            required
          )
        );
      }
      if (!vals.left.isAuto) {
        constrain(
          eq(actual.margin._left,
            c.Plus(ref.margin._left, vals.left.px),
            required
          )
        );
      }
      if (!vals.right.isAuto) {
        constrain(
          eq(actual.margin._right,
            c.Minus(ref.margin._right, vals.right.px),
            required
          )
        );
      }
      if (!vals.bottom.isAuto) {
        constrain(
          eq(actual.margin._bottom,
            c.Minus(ref.margin._bottom, vals.bottom.px),
            required
          )
        );
      }
    } else if(pos == "absolute" || pos == "fixed") {
      if (!vals.top.isAuto) {
        constrain(
          eq(
            actual.margin._top,
            c.Plus(containing.margin._top, vals.top.px),
            required
          )
        );
      }
      if (!vals.left.isAuto) {
        constrain(
          eq(actual.margin._left,
            c.Plus(containing.margin._left, vals.left.px),
            required
          )
        );
      }
      if (!vals.right.isAuto) {
        constrain(
          eq(actual.margin._right,
            c.Minus(containing.margin._right, vals.right.px),
            required
          )
        );
      }
      if (!vals.bottom.isAuto) {
        constrain(
          eq(actual.margin._bottom,
            c.Minus(containing.margin._bottom, vals.bottom.px),
            required
          )
        );
      }
    }

    //
    // TODO(slightlyoff)
    //
  },
});

var Block = c.inherit({
  extends: RenderBox, // TODO: Block, 
  _className: "Block",
  initialize: function(node, cb){
    RenderBox.call(this, node, cb);
    cb.addBlock(this);
    this._hasBlocks = false;
    this._hasInlines = false;
    this._openAnonymousBlock = null;
    this._anonymousBLocks = [];
  },
  addBlock: function(b) {
    if (b == this) { return; }
    // console.log("block:", this.node.tagName, "got block", b.node);

    if (this._openAnonymousBlock) {
      // Open season is now closed.
      this._openAnonymousBlock = null;
    }
  },
  addInline: function(i) {
    // console.log("block:", this.node.tagName, "got inline", i.node);
    if (!this._openAnonymousBlock) {
      // Open season is now closed.
      this._openAnonymousBlock = new AnonymousBlock(this);
      this._anonymousBLocks.push(this._openAnonymousBlock);
      if (this._isFlowRoot) {
        this.addFlowBox(this._openAnonymousBlock);
      } else if (this.flowRoot) {
        this.flowRoot.addFlowBox(this._openAnonymousBlock);
      } else {
        console.error("No FlowRoot found when attempting to flow anonymous box in:", this);
      }
    }
    this._openAnonymousBlock.addInline(i);
  },
  // Hook generation so that our generated blocks don't get left out.
  generate: function() {
    RenderBox.prototype.generate.call(this);
    this._anonymousBLocks.forEach(function(ab){ ab.generate(); });
  },
});

var AnonymousBlock = c.inherit({
  extends: RenderBox, // TODO: Block, 
  _className: "AnonymousBlock",
  initialize: function(cb){
    Edgy.call(this);
    this.containingBlock = cb;
    this.solver = cb.solver;
  },
  addInline: function(i) {
    // Collect inlines for line box generation.
  },
  generate: function() {
    // Stub us out.
  },
});

var Viewport = c.inherit({
  extends: Block, // TODO: Block, 
  _className: "Viewport", // for toString()
  initialize: function(width, height, node){
    // Viewport:
    //  The item that everything else is realtive to. It takes a source node
    //  whose dimensions it copies, setting margin/padding/border to zero.
    this.solver = new c.SimplexSolver();
    Block.call(this, node, this);
    FlowRoot.call(this);
    //TODO: Block.call(this, node);
    this.naturalSize = new MeasuredBox(0, 0, width, height);
    this.containingBlock = this;
    this.generate();
  },
  generate: function() {
    var actual = this.edges.actual;
    var solver = this.solver;
    var width = this.naturalSize.width;
    var height = this.naturalSize.height;
    var constrain = solver.add.bind(solver);

    ["margin", "border", "padding", "content"].forEach(function(type) {
      constrain(
        eq(actual[type]._left, 0, required),
        eq(actual[type]._top, 0, required),
        eq(actual[type]._right, width, required),
        eq(actual[type]._bottom, height, required)
      );
    });
  },
});


var Inline = c.inherit({
  extends: RenderBox,
  _className: "Inline", // for toString()
  initialize: function(node, cb){
    RenderBox.call(this, node, cb);
    cb.addInline(this);
  },
});

var TextBox = c.inherit({
  extends: Inline,
  _className: "TextBox", // for toString()
  initialize: function(node, cb){
    this.text = node.nodeValue;
    Inline.call(this, node, cb);
    this.edges.ref = null; // We deal only in actual values.
  },
  generate: function() {
    // TODO(slightlyoff):
    //      set our top to the prev's top or the containing's content top (or
    //      whatever makes sense based on text-align)

    // Michalowski '98, Section 3.2
    // Line-box Constraints

    // FIXME(slightlyoff): need to add the float constraints back in!
 
    // c.top + this.css("line-height").px;
    // console.log(this.naturalSize.width, this.naturalSize.height);

    var actual = this.edges.actual;
    var solver = this.solver;
    var constrain = solver.add.bind(solver);
    var containing = this.containingBlock.edges.actual;

    var _width = new c.Variable();
    var _height = new c.Variable();

    constrain(eq(_width, this.naturalSize.width, medium));
    constrain(eq(_height, this.naturalSize.height, medium));

    constrain(
      eq(c.Plus(actual.content._left, _width), actual.content._right, required),
      eq(c.Plus(actual.content._top, _height), actual.content._bottom, required)
    );

  },
});

//////////////////////////////////////////////////////
//  Workhorse functions
//////////////////////////////////////////////////////

var findBoxGenerators = function(element) {
  var doc = element.ownerDocument || document;
  var global = doc.defaultView || scope;
  var NodeFilter = global.NodeFilter;
  var generators = [];
  var nf = NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_DOCUMENT;

  var tw = doc.createTreeWalker(
    element,
    nf,
    {
      acceptNode: function(node) {
        // Filter on elements that have some sort of display
        if (node.nodeType == 1) {
          var cs = global.getComputedStyle(node);
          if (cs.getPropertyValue("display") == "none") {
            return NodeFilter.FILTER_REJECT;
          }
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    },
    false);

  while(tw.nextNode()) {
    generators.push(tw.currentNode);
  }
  return generators;
};

// *Super*-hacky content measurement. Known-busted in the following ways:
//  - does not cascade font sizing/family/line-height/etc. information
//  - likely breaks any/all :before and :after rules
//  - does not measure generated content
//  - probably broken on tables and other element types that need specific
//    hosting parents
// The right answer, of course, is to just plumb through a measurement API from
// WebKit directly and use this only in case of fallback.
var docMeasureNodeMap = new Map();
var getMeasureNode = function(doc) {
  var mn = docMeasureNodeMap.get(doc);
  if (mn) return mn;

  var mn = doc.createElement("div");
  mn.style.display = "inline-block";
  mn.style.position = "absolute";
  mn.style.left = "-5000px";
  mn.style.top = "-5000px";
  mn.style.visibility = "hidden";
  mn.style.pointerEvents = "none";
  mn.style.padding = "0px";
  mn.style.border = "0px";
  mn.style.margin = "0px";
  doc.documentElement.appendChild(mn);
  docMeasureNodeMap.set(doc, mn);
  return mn;
};

var contentSize = function(node) {
  var w = 0,
      h = 0,
      doc = node.ownerDocument;
  var m = getMeasureNode(doc);
  m.innerHTML = "";
  var c = node.cloneNode(true);
  if (c.nodeType == 1) {
    c.style.width = "auto !important";
    c.style.height = "auto !important";
  }
  m.appendChild(c);
  return new MeasuredBox(0, 0, m.scrollWidth, m.scrollHeight);
};

var _generateFor = function(id, boxesCallback) {
  // TODO(slightlyoff):
  //    Make generic by allowing the current document/scope to be
  //    generated for in addition to same-domain iframes.
  var g = global(id);
  if (!g) {
    console.log("FAIL: couldn't script other window!");
    return;
  }
  var d = doc(id),
      visibleNodes = findBoxGenerators(d.documentElement);

  // console.log(visibleNodes);

  var viewportNode = document.getElementById(id);
  var dde = d.documentElement;
  var v = new Viewport(viewportNode.clientWidth, viewportNode.clientHeight, dde);

  var nodeToBoxMap = new Map();
  nodeToBoxMap.set(dde, v);

  // Run through the visible nodes, creating box types as needed and setting
  // forward/back/ref references.

  // The most recent document-ordered element that is not absolute, fixed, or float
  var prev = null;
  var containing = v;

  // var containingNode = dde;
  // var containingStack = [{ box: v, node: containingNode }];

  var boxes = [];
  var flowRoots = [];
  var solver = v.solver;
  var defaultBlockProgression = "tb";

  var getContainingBlock = function(n) {
    // Everything has a containing block. CSS 3 says:
    //
    //      "The containing block of other boxes is the rectangle formed by the
    //      content edge of their nearest ancestor box that is block-level.
    //      This may be an anonymous box. The ‘direction’ and
    //      ‘block-progression’ of the containing block are those of the box
    //      whose content edge it is."
    //
    // Since we've visiting in document order, we can simply look up through
    // our ancestors to see which one is block, else our containing block is
    // the viewport.

    // Positioned elements need positioned parents!
    var pn = n.parentNode;

    if (isFixed(n)) {
      // Fixed elements are always relative to the viewport.
      pn = dde;
    } else {
      if (!isPositioned(n)) {
        while (pn && pn != dde && !isBlock(pn)) {
          pn = pn.parentNode;
        }
      } else {
        // console.log("looking for a positioned parent for:", n);
        while (pn && pn != dde && !(isBlock(pn) && isPositioned(pn))) {
          pn = pn.parentNode;
        }
        // console.log("found:", pn);
      }
    }

    if (!pn) { pn = dde; }
    return nodeToBoxMap.get(pn);
  };

  var getFlowRoot = function(n) {
    var pn = n.parentNode;
    while (pn && pn != dde && !nodeToBoxMap.get(pn)._isFlowRoot) {
      pn = pn.parentNode;
    }
    if (!pn) { pn = dde; }
    return nodeToBoxMap.get(pn);
  };

  visibleNodes.forEach(function(node) {
    var parentBox = nodeToBoxMap.get(node.parentNode);

    var cb = getContainingBlock(node);

    // console.log("containingBlock:", cb.node, "for node:", node);

    // Boxes in CSS always ahve "containing blocks". Boxes that are in a flow
    // also have "flow roots".
    if (isElement(node)) {
      // console.log("isBlock:", isBlock(node), "isInline:", isInline(node), node);
      // console.log("containgBlock node:", getContainingBlock(node).node);

      // TODO(slightlyoff): implement run-in detection
      var b;
      if (isBlock(node)) {
        b = new Block(node, cb);
      }
      if (isInline(node)) {
        b = new Inline(node, cb);
      }

      if (isInFlow(node)) {
        getFlowRoot(node).addFlowBox(b);
      }
      nodeToBoxMap.set(node, b);
      boxes.push(b);
      if (b._isFlowRoot) {
        flowRoots.push(b);
      }
      prev = b;

    } else {
      // We're a text node, so create text blocks for the constituent words and
      // add them to our container's inlines list.
 
      //  Could *really* do with access to these right about now:
      //   http://msdn.microsoft.com/en-us/library/windows/desktop/dd319118(v=vs.85).aspx
      //   http://developer.apple.com/library/mac/#documentation/Carbon/Reference/CTLineRef/Reference/reference.html
      var head = node;
      var tail = null;
      var pn = node.parentNode;
      var cs = g.getComputedStyle(pn);
      node.nodeValue.split(/\s+/).forEach(function(word) {
        if (!word) { return; }
        // Next, find the index of the current word in our remaining node,
        // split on the word end, and create LineBox items for the newly
        // split-off head element.
        var hnv = head.nodeValue;
        if (hnv.indexOf(word) >= 0) {
          tail = head.splitText(hnv.indexOf(word)+word.length);
          var b = new TextBox(head, cb)
          nodeToBoxMap.set(head, b);
          boxes.push(b);
          prev = b;
        }
        head = tail;
      });
    }

    /*
    switch (node.nodeType) {
      case 1: // Element
        // FIXME(slightlyoff):
        //      Need to create render boxes for generated content, so need to
        //      test for :before and :after when we get the computed style for
        //      each node.
        var b = new RenderBox(containing, prev, g.getComputedStyle(node), node);
        var pos = b.css("position");
        if (pos != "absolute" && pos != "fixed" && pos != "float") {
          prev = b;
        }
        if (pos == "absolute" || pos == "relative" || pos == "float") {
          while (!containingNode.contains(node)) {
            var csi = containingStack.pop();
            // console.log("popped:", csi);
            containingNode = csi.node;
            containing = csi.box;
            // FIXME: how does this affect prev?
          }
          containingStack.push({ box: b, node: node });
          // console.log("pushed:", containingStack[containingStack.length - 1]);
          containingNode = node;
          containing = b;
        }
        nodeToBoxMap.set(node, b);
        boxes.push(b);
        // FIXME(slightlyoff):
        //      If our pos isn't the default, we are the new "containing" for
        //      children.
        return;
      case 3: // TextNode

        // FIXME: need to find some way to linearize the following if/else that
        // we need for inline-level boxes:
        // if (previous.RM + width <= enclosing.RP) {
        //   // If we're not going to intersect the right-hand-side of our
        //   // container, put our left at the previous right and or top at the
        //   // previous top.
        //   ref.TM = previous.RM?
        //   ref.LM = previous.TM?
        // } else {
        //   // Else, drop down a line and go flush left.
        //   ref.TM = previous.BM?
        //   ref.LM = 0
        // }
        //
        // http://www.aimms.com/aimms/download/manuals/aimms3om_integerprogrammingtricks.pdf

        var head = node;
        var tail = null;
        var pn = node.parentNode;
        var cs = g.getComputedStyle(pn);
        node.nodeValue.split(/\s+/).forEach(function(word) {
          if (!word) { return; }
          // Next, find the index of the current word in our remaining node,
          // split on the word end, and create LineBox items for the newly
          // split-off head element.
          var hnv = head.nodeValue;
          if (hnv.indexOf(word) >= 0) {
            tail = head.splitText(hnv.indexOf(word)+word.length);
            var b = new TextBox(containing, prev, head.nodeValue, cs, head)
            nodeToBoxMap.set(head, b);
            boxes.push(b);
            prev = b;
            // console.log("'"+head.nodeValue+"'");
          }
          head = tail;
        });
        return;
      default:
        // console.log("WTF?:", node);
        break;
    }
    // console.log("'" + node.nodeValue + "'", b.naturalSize.width, b.naturalSize.height);
    // console.log("natural size:", b.naturalSize.width, b.naturalSize.height, "node type:", node.nodeType);
    */
  });

  // Add the viewport to the list.
  boxes.unshift(v);
  flowRoots.unshift(v);

  // FIXME(slightlyoff):
  //    Add anonymous boxe parents here for text children of flow roots with
  //    other block children.

  // Generate our generic box constraints.
  boxes.forEach(function(box) {
    box.generate();
  });


  flowRoots.forEach(function(root) {
    console.log("flowing root:", root+"");
    root.flow();
  });

  // Generate constraints to resolve widths.

  // solver.resolve();

  // Text layout pass. Once our widths have all been determined, we place each
  // text segment and do wrapping. Once we've
  // solved for flowed blocks, we update our container's height to fit and
  // re-solve the entire system. We only call for painting once this has been
  // done everywhere.
  //
  boxes.forEach(function(box) {
  });

  // TODO(slightlyoff): sort boxes into stacking contexts for rendering!
  //                    See CSS 2.1 section E.2 for details.

  // boxes.forEach(function(box) { console.log(box+""); });

  boxesCallback(boxes);
};

scope.generateFor = function(id, boxesCallback) {
  ready(function() { _generateFor(id, boxesCallback) }, id);
};

})(this);
