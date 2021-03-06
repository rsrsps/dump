function Chessboard()
{
  this.squares = [
    "a1", "b1", "c1", "d1", "e1", "f1", "g1", "h1", "", "", "", "", "", "", "", "",
    "a2", "b2", "c2", "d2", "e2", "f2", "g2", "h2", "", "", "", "", "", "", "", "",
    "a3", "b3", "c3", "d3", "e3", "f3", "g3", "h3", "", "", "", "", "", "", "", "",
    "a4", "b4", "c4", "d4", "e4", "f4", "g4", "h4", "", "", "", "", "", "", "", "",
    "a5", "b5", "c5", "d5", "e5", "f5", "g5", "h5", "", "", "", "", "", "", "", "",
    "a6", "b6", "c6", "d6", "e6", "f6", "g6", "h6", "", "", "", "", "", "", "", "",
    "a7", "b7", "c7", "d7", "e7", "f7", "g7", "h7", "", "", "", "", "", "", "", "",
    "a8", "b8", "c8", "d8", "e8", "f8", "g8", "h8", "", "", "", "", "", "", "", ""
  ];
  this.sqIDs = {"a1":0,"b1":1,"c1":2,"d1":3,"e1":4,"f1":5,"g1":6,"h1":7,"a2":16,"b2":17,"c2":18,"d2":19,"e2":20,"f2":21,"g2":22,"h2":23,"a3":32,"b3":33,"c3":34,"d3":35,"e3":36,"f3":37,"g3":38,"h3":39,"a4":48,"b4":49,"c4":50,"d4":51,"e4":52,"f4":53,"g4":54,"h4":55,"a5":64,"b5":65,"c5":66,"d5":67,"e5":68,"f5":69,"g5":70,"h5":71,"a6":80,"b6":81,"c6":82,"d6":83,"e6":84,"f6":85,"g6":86,"h6":87,"a7":96,"b7":97,"c7":98,"d7":99,"e7":100,"f7":101,"g7":102,"h7":103,"a8":112,"b8":113,"c8":114,"d8":115,"e8":116,"f8":117,"g8":118,"h8":119};
  var testboard = [
    "wr", "wn", "wb", "wq", "wk", "wr", "ee", "wr", "", "", "", "", "", "", "", "",
    "wp", "wp", "wp", "wp", "ee", "ee", "wp", "wp", "", "", "", "", "", "", "", "",
    "ee", "ee", "ee", "ee", "ee", "ee", "ee", "ee", "", "", "", "", "", "", "", "",
    "ee", "ee", "ee", "ee", "wp", "wr", "ee", "ee", "", "", "", "", "", "", "", "",
    "ee", "ee", "ee", "bp", "wp", "bp", "ee", "ee", "", "", "", "", "", "", "", "",
    "ee", "ee", "ee", "ee", "ee", "ee", "ee", "bk", "", "", "", "", "", "", "", "",
    "bp", "bp", "bp", "ee", "bp", "ee", "wp", "bp", "", "", "", "", "", "", "", "",
    "br", "bn", "bb", "bq", "ee", "bb", "ee", "br", "", "", "", "", "", "", "", ""
  ];
  this.board = [
    "wr", "wn", "wb", "wq", "wk", "wb", "wn", "wr", "", "", "", "", "", "", "", "",
    "wp", "wp", "wp", "wp", "wp", "wp", "wp", "wp", "", "", "", "", "", "", "", "",
    "ee", "ee", "ee", "ee", "ee", "ee", "ee", "ee", "", "", "", "", "", "", "", "",
    "ee", "ee", "ee", "ee", "ee", "ee", "ee", "ee", "", "", "", "", "", "", "", "",
    "ee", "ee", "ee", "ee", "ee", "ee", "ee", "ee", "", "", "", "", "", "", "", "",
    "ee", "ee", "ee", "ee", "ee", "ee", "ee", "ee", "", "", "", "", "", "", "", "",
    "bp", "bp", "bp", "bp", "bp", "bp", "bp", "bp", "", "", "", "", "", "", "", "",
    "br", "bn", "bb", "bq", "bk", "bb", "bn", "br", "", "", "", "", "", "", "", ""
  ];
  this.isSlider = { "r": true, "n": false, "b": true, "q": true, "k": false, "p": false };
  this.pieceDeltas = {
    "r": [-1, -16, 1, 16],
    "b": [-17, -15, 17, 15],
    "n": [-33, -31, -14, 18, 33, 31, 14, -18],
    "p": [15, 17]
  };
  this.pieceDeltas["k"] = this.pieceDeltas["q"] = this.pieceDeltas["r"].concat(this.pieceDeltas["b"]);
  
  this.turn = "w";
  this.turnFlip = {"w": "b", "b": "w"};
  
  this.castling = {"wk": true, "wq": true, "bk": true, "bq": true};
  this.castlings = [];
  this.material = 0;
  this.materials = { "k": 200, "q": 9, "r": 5, "b": 3.3, "n": 3.2, "p": 1 };
  
  this.ep = this.sqIDs["f6"];
  this.eps = [];
}

Chessboard.prototype.evaluate = function() {
  return (this.turn == "w") ? this.material : -this.material;
}

Chessboard.prototype.isAttacked = function(sq, side) {
  for (var piece in this.pieceDeltas) {
    var deltas = this.pieceDeltas[piece];
    for (var i = 0; i < deltas.length; ++i) {
      if (this.isSlider[piece])
        for (var to = sq + deltas[i]; (to & 0x88) == 0; to += deltas[i]) {
          if (this.board[to] != "ee") {
            if (this.board[to] == (side + piece)) {
              return true;
            }
            break;
          }
        }
      else {
        var sign = (this.turnFlip[side] == "w") ? 1 : -1; // used for pawns
        var to = sq + sign*deltas[i];
        if (to & 0x88) continue; // off board
        if (this.board[to] == (side + piece)) {
          return true;
        }
      }
    }
  }
  return false;
}

Chessboard.prototype.make = function(move) {
  this.castlings.push({
    "wk": this.castling.wk, "wq": this.castling.wq,
    "bk": this.castling.bk, "bq": this.castling.bq
  });
  this.eps.push(this.ep);
  if (move.substring(0, 3) == "O-O") {
    var rank = (this.turn == "w") ? "1" : "8";
    var kto = (move == "O-O") ? "g" : "c";
    var rfr = (move == "O-O") ? "h" : "a";
    var rto = (move == "O-O") ? "f" : "d";
    this.board[this.sqIDs[kto+rank]] = this.board[this.sqIDs["e"+rank]];
    this.board[this.sqIDs["e"+rank]] = "ee";
    this.board[this.sqIDs[rto+rank]] = this.board[this.sqIDs[rfr+rank]];
    this.board[this.sqIDs[rfr+rank]] = "ee";
    this.castling[this.turn+"k"] = this.castling[this.turn+"q"] = false;
  } else {
    var piece = move[0].toLowerCase();
    var fr = this.sqIDs[move[1] + move[2]];
    var to = this.sqIDs[move[3] + move[4]];
    if (piece == "k")
      this.castling[this.turn+"k"] = this.castling[this.turn+"q"] = false;
    if (to == this.sqIDs["a1"]) this.castling["wk"] = false;
    if (to == this.sqIDs["h1"]) this.castling["wq"] = false;
    if (to == this.sqIDs["a8"]) this.castling["bk"] = false;
    if (to == this.sqIDs["h8"]) this.castling["bq"] = false;
    var sign = (this.turn == "w") ? -1 : 1;
    this.board[to] = this.board[fr];
    this.board[fr] = "ee";
    if (move.indexOf("ep") != -1) {
      this.board[to + sign*16] = "ee";
    }
    this.ep = ((piece == "p") && (Math.abs(to - fr) == 32)) ? to + sign*16 : -1;
    if (move.indexOf("=") != -1) {
      var prom = move[move.length-1].toLowerCase();
      this.board[to] = this.turn + prom;
      this.material += -sign * (this.materials[prom] - this.materials["p"]);
    }
    var xi = move.indexOf("x");
    if (xi != -1)
      this.material += -sign * this.materials[move.substring(xi + 2, xi + 3)];
  }
  this.turn = this.turnFlip[this.turn];
}

Chessboard.prototype.unmake = function(move) {
  this.castling = this.castlings.pop();
  this.ep = this.eps.pop();
  this.turn = this.turnFlip[this.turn];
  if (move.substring(0, 3) == "O-O") {
    var rank = (this.turn == "w") ? "1" : "8";
    var kfr = (move == "O-O") ? "g" : "c";
    var rto = (move == "O-O") ? "h" : "a";
    var rfr = (move == "O-O") ? "f" : "d";
    this.board[this.sqIDs["e"+rank]] = this.board[this.sqIDs[kfr+rank]];
    this.board[this.sqIDs[kfr+rank]] = "ee";
    this.board[this.sqIDs[rto+rank]] = this.board[this.sqIDs[rfr+rank]];
    this.board[this.sqIDs[rfr+rank]] = "ee";
  } else {
    var piece = move[0].toLowerCase();
    var fr = this.sqIDs[move[3] + move[4]];
    var to = this.sqIDs[move[1] + move[2]];
    var sign = (this.turn == "w") ? -1 : 1;
    var xi = move.indexOf("x");
    var capt = (xi != -1) ? move.substring(xi + 1, xi + 3) : "ee";
    this.board[to] = this.board[fr];
    this.board[fr] = capt;
    if (xi != -1)
      this.material -= -sign * this.materials[capt[1]];
    if (move.indexOf("ep") != -1) {
      this.board[fr + sign*16] = this.turnFlip[this.turn] + "p";
    }
    if (move.indexOf("=") != -1) {
      this.board[to] = this.turn + "p";
      this.material -= -sign * (this.materials[move[move.length-1].toLowerCase()] - this.materials["p"]);
    }
  }
}

Chessboard.prototype.indexOf = function(piece) {
  for (var i = 0; i < this.board.length; ++i)
    if (this.board[i] == piece)
      return i;
  return -1;
}

Chessboard.prototype.movegen = function() {
  var moves = [];
  for (var i = 0; i < 64; ++i) {
    var sq = i + (i & ~7);
    if (this.board[sq][0] == this.turn) { // if current piece can move
      if (this.board[sq][1] != "p") { // if not pawn
        var deltas = this.pieceDeltas[this.board[sq][1]];
        for (var j = 0; j < deltas.length; ++j) { // for all deltas
          if (this.isSlider[this.board[sq][1]]) { // if sliding
            for (var to = sq + deltas[j]; (to & 0x88) == 0; to += deltas[j]) { // while tosq is on board, generate sliding attacks
              if (this.board[to] != "ee") { // if obstructed
                if (this.board[to][0] != this.turn) { // if obstructed piece is enemy
                  moves.push(this.board[sq][1].toUpperCase() + this.squares[sq] + this.squares[to] + "x" + this.board[to]);
                }
                break; // stop generating sliding attacks
              } else { // add sliding attack and continue
                moves.push(this.board[sq][1].toUpperCase() + this.squares[sq] + this.squares[to]);
              }
            }
          } else { // not sliding, just add the single delta
             var to = sq + deltas[j];
             if ((to & 0x88) || (this.board[to][0] == this.turn)) continue; // off board or friendly obstruction
             var capt = (this.board[to] != "ee") ? "x" + this.board[to] : "";
             moves.push(this.board[sq][1].toUpperCase() + this.squares[sq] + this.squares[to] + capt);
          }
        }
        if (this.board[sq][1] == "k") { // if king, generate castlings
          var sqcheck = {
            "w": {
              "k": [this.sqIDs["f1"], this.sqIDs["g1"]],
              "q": [this.sqIDs["b1"], this.sqIDs["c1"], this.sqIDs["d1"]],
            },
            "b": {
              "k": [this.sqIDs["f8"], this.sqIDs["g8"]],
              "q": [this.sqIDs["b8"], this.sqIDs["c8"], this.sqIDs["d8"]],
            }
          };
          var types = {"k": "O-O", "q": "O-O-O"};
          for (var type in types) {
            if (this.castling[this.turn + type]) {
              var ok = true;
              for (var j = 0; j < sqcheck[this.turn][type].length; ++j) {
                var chk = sqcheck[this.turn][type][j];
                if (this.board[chk] != "ee" || this.isAttacked(chk, this.turnFlip[this.turn]))
                  ok = false;
              }
              if (ok)
                moves.push(types[type]);
            }
          }
        }
      } else { // pawn moves
        var capts = [17, 15];
        var sign = (this.turn == "w") ? 1 : -1;
        var doubleRank = (this.turn == "w") ? "2" : "7";
        var promRank = (this.turn == "w") ? "7" : "2";
        
        var first = sq + sign*16, second = sq + sign*32;
        if (((first & 0x88) == 0) && (this.board[first] == "ee")) {
          if (this.squares[sq][1] == promRank) {
            moves.push("P" + this.squares[sq] + this.squares[first] + "=Q");
            moves.push("P" + this.squares[sq] + this.squares[first] + "=R");
            moves.push("P" + this.squares[sq] + this.squares[first] + "=B");
            moves.push("P" + this.squares[sq] + this.squares[first] + "=N");
          } else {
            moves.push("P" + this.squares[sq] + this.squares[first]);
          }
          if ((this.squares[sq][1] == doubleRank) && ((second & 0x88) == 0) && (this.board[second] == "ee"))
            moves.push("P" + this.squares[sq] + this.squares[second]);
        }
        for (var j = 0; j < capts.length; ++j) {
          var capt = sq + sign*capts[j];
          if ((capt & 0x88) == 0) {
            if (this.board[capt][0] == this.turnFlip[this.turn]) {
              if (this.squares[sq][1] == promRank) {
                moves.push("P" + this.squares[sq] + this.squares[capt] + "x" + this.board[capt] + "=Q");
                moves.push("P" + this.squares[sq] + this.squares[capt] + "x" + this.board[capt] + "=R");
                moves.push("P" + this.squares[sq] + this.squares[capt] + "x" + this.board[capt] + "=B");
                moves.push("P" + this.squares[sq] + this.squares[capt] + "x" + this.board[capt] + "=N");
              } else {                                                                
                moves.push("P" + this.squares[sq] + this.squares[capt] + "x" + this.board[capt]);
              }
            }
            if (this.ep == capt) {
              moves.push("P" + this.squares[sq] + this.squares[capt] + "ep");
            }
          }
        }
      }
    }
  }
  return moves;
}

Chessboard.prototype.legalize = function(moves) {
  var result = [];
  for (var i = 0; i < moves.length; ++i) {
    if ((moves[i].substring(0, 3) == "O-O") // can't castle out of check
      && this.isAttacked(this.indexOf(this.turn+"k"), this.turnFlip[this.turn]))
      continue;
    this.make(moves[i]);
    if (!this.isAttacked(this.indexOf(this.turnFlip[this.turn]+"k"), this.turn))
      result.push(moves[i]);
    this.unmake(moves[i]);
  }
  return result;
}

Chessboard.prototype.sanList = function() {
  var moves = this.legalize(this.movegen());
  var result = {};
  for (var i = 0; i < moves.length; ++i) {
    this.make(moves[i]);
    var check = (this.isAttacked(this.indexOf(this.turn+"k"), this.turnFlip[this.turn])) ?
      ((this.legalize(this.movegen()).length == 0) ? "#" : "+") :
      "";
    this.unmake(moves[i]);
    if (moves[i].substring(0, 3) == "O-O")
      result[moves[i] + check] = moves[i];
    else {
      var isCapt = ((moves[i].indexOf("x") != -1) || (moves[i].indexOf("ep") != -1));
      var piece = (moves[i][0] != "P") ? moves[i][0] : (isCapt ? moves[i][1] : "");
      var fr = moves[i].substring(1, 3);
      var to = moves[i].substring(3, 5);
      var capt = isCapt ? "x" : "";
      var prom = (moves[i].indexOf("=") != -1) ? moves[i].substring(moves[i].length-2, moves[i].length) : "";
      var dis = "";
      for (var j = 0; j < moves.length; ++j) {
        if (i != j) {
          if ((moves[j][0] == piece) && (moves[j].substring(3, 5) == to)) {
            var other = moves[j].substring(1, 3);
            for (var k = other.length-1; k >= 0; --k)
              if (fr[k] != other[k])
                dis = fr[k];
            break;
          }
        }
      }
      result[piece + dis + capt + to + prom + check] = moves[i];
    }
  }
  return result;
}

Chessboard.prototype.apply = function(sans) {
  for (var i = 0; i < sans.length; ++i) {
    var legal = this.sanList();
    if (!(sans[i] in legal)) {
      console.log(sans[i] + " is illegal: legal moves are " + Object.keys(legal).join(", "));
    } else {
      this.make(legal[sans[i]]);
      console.log("Made move: " + sans[i] + " => " + legal[sans[i]] + ". Current eval: " + this.evaluate());
    }
  }
}

Chessboard.prototype.negamax = function(depth) {
  if (depth == 0)
    return this.evaluate();
  var max = -1e100;
  var moves = this.legalize(this.movegen());
  for (var i = 0; i < moves.length; ++i)  {
    this.make(moves[i]);
    score = -this.negamax(depth - 1);
    this.unmake(moves[i]);
    if (score > max)
        max = score;
  }
  return max;
}

Chessboard.prototype.alphabeta = function(alpha, beta, depth) {
  if (depth == 0) return this.evaluate(); //quiesce(alpha, beta);
  var moves = this.legalize(this.movegen());
  for (var i = 0; i < moves.length; ++i)  {
    this.make(moves[i]);
    var score = -this.alphabeta(-beta, -alpha, depth - 1);
    this.unmake(moves[i]);
    if (score >= beta)
      return beta; //  fail hard beta-cutoff
    if (score > alpha)
      alpha = score; // alpha acts like max in MiniMax
  }
  return alpha;
}

Chessboard.prototype.go = function(depth) {
  if (depth == 0) return this.evaluate(); //quiesce(alpha, beta);
  var alpha = -1e100, beta = 1e100;
  var moves = this.legalize(this.movegen());
  var best = -1;
  for (var i = 0; i < moves.length; ++i) {
    this.make(moves[i]);
    var score = -this.alphabeta(-beta, -alpha, depth - 1);
    this.unmake(moves[i]);
    if (score >= beta)
      return beta;
    if (score > alpha) {
      alpha = score;
      var best = i;
    }
  }
  return { score: alpha, best: moves[best] };
}

Chessboard.prototype.influence = function(side, legal) { //?? legality
  var result = Array(128);
  for (var i = 0; i < result.length; ++i)
    result[i] = 0;
  for (var i = 0; i < 64; ++i) { // for each sq
    var sq = i + (i & ~7);
    if (this.board[sq][0] == side) { // if piece @ sq is friendly
      var deltas = this.pieceDeltas[this.board[sq][1]];
      for (var j = 0; j < deltas.length; ++j) // for all deltas
        if (this.isSlider[this.board[sq][1]]) // if sliding, generate sliding attacks
          for (var to = sq + deltas[j]; (to & 0x88) == 0; to += deltas[j]) { // while tosq is on board
            result[to] += 1;
            if (this.board[to] != "ee") break; // obstruction
          }
        else { // not sliding, just add the single delta
            var sign = (side == "w") ? 1 : -1; // used for pawns
            var to = sq + sign*deltas[j];
            if (to & 0x88) continue; // off board
            result[to] += 1;
        }
    }
  }
  return result;
}

Chessboard.prototype.heatmap = function() {
  var result = Array(64);
  var w = this.influence("w", false);
  var b = this.influence("b", false);
  for (var i = 0; i < 64; ++i) {
    var sq = i + (i & ~7);
    result[i] = w[sq] - b[sq];
  }
  return result;
}

if (typeof overlay == "undefined") {
  var overlay = document.createElement('div');
  overlay.style.opacity = 1;
  overlay.style.zIndex = 1;
  overlay.style.position = 'fixed';
  overlay.style.left = '70px';
  overlay.style.top = '65px';
  overlay.style.width = '456px';
  overlay.style.height = '456px';
  document.body.appendChild(overlay);
  initDisplay();
}
var moves = [];
var getMoves = function() {
  var movelist = document.getElementsByClassName('chessboard_moveList')[0].children[0];
  var moves = [];
  for (var i = 0; i < 2 * movelist.children.length; ++i) {
    var move = movelist.children[i >> 1].children[(i & 1) + 1].children[0].innerText;
    if (move.trim() != "") moves.push(move);
  };
  return moves;
};
if (typeof tickInterval != "undefined") clearInterval(tickInterval);
tickInterval = setInterval(function(){var m = getMoves(); if (m.join(" ") != moves.join(" ")) { moves = m; moveChange(); }}, 100);

function initDisplay() {
  for (var i = 0; i < 64; ++i) {
    overlay.appendChild(document.createElement('div'));
    overlay.children[i].style.float = "left";
    overlay.children[i].style.left = ((100*(i%8)/8).toString()) + "%";
    overlay.children[i].style.top = ((100*(i>>3)/8).toString()) + "%";
    overlay.children[i].style.width = (100/8).toString() + "%";
    overlay.children[i].style.height = (100/8).toString() + "%";
  }
}

function updateDisplay(heatmap) {
  var scheme = { // matlab imagesc scheme
    "-5": "rgb(53, 42, 134)",
    "-4": "rgb(31, 82, 211)",
    "-3": "rgb(12, 116, 220)",
    "-2": "rgb(12, 147, 209)",
    "-1": "rgb(6, 169, 192)",
     "0": "rgb(55, 184, 157)",
     "1": "rgb(124, 191, 123)",
     "2": "rgb(183, 188, 99)",
     "3": "rgb(240, 185, 73)",
     "4": "rgb(249, 210, 41)",
     "5": "rgb(248, 250, 13)"
  };
  for (var i = 0; i < 64; ++i) {
    overlay.children[i].style.backgroundColor = scheme[eval(heatmap[i]).toString()];
    overlay.children[i].innerText = heatmap[i];
  }
}

var flip = false;
var heatmap = Array(64);
var c;
for (var i = 0; i < heatmap.length; ++i) heatmap[i] = 0;
function moveChange() {
  var start = Date.now();
  c = new Chessboard();
  c.apply(moves);
  var nheatmap = c.heatmap();
  var translated = Array(64);
  for (var i = 0; i < 8; ++i) {
    for (var j = 0; j < 8; ++j) {
      translated[i*8 + j] = flip ? nheatmap[8*i + (7-j)] : nheatmap[8*(7-i) + j];
    }
  }
  var deltas = Array(64);

  for (var i = 0; i < 64; ++i) {
    deltas[i] = "(" + translated[i].toString() + ")-(" + heatmap[i].toString() + ")";
  }
  updateDisplay(deltas);
  heatmap = translated;
  console.log("Total time: " + (Date.now() - start) + " ms");
}