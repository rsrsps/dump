'use strict'

//TODO:
// when in check, only generate king moves or captures or moves that intersect king (make 'bitmap' of just byte * 128 * 128, 16 KB lookup table)
//   or, return the checker. generate king moves or captures of the checking piece (including en passant)
//   if bishop/rook/queen, also generate intercepting moves
// quiescence
// keep track of sides that are in check?
// use Arraybuffer/view tricks to decompose things into fields?
// use fancy chess piece symbols in print()?
// detect repetition
// latency table for different moves based on from-to distance
// use stockfish psts?
// endgame pst's
// late move reduction somehow preventing seeing longer checkmate sequences
// sign issues with scores? check <= fancier things in transposition table (e.g. if already searched depth n, don't search any depth m < n ever again)
// pseudo-legal move generation
// to get tt usage: tt.map((e, i) => e > 0 ? i : 0).filter(e => e)
// [^\r\n]*(Searching d|Made move|[a-h][0-9][a-h][0-9]|Time remaining|Allocating|No. of)[^\r\n]*\r\n

var DEBUG                    = true    // debugging output
var PERFT                    = false   // runs through a suite of test perfts
var INTERFACE                = true    // extracts moves from lichess and displays recommended moves
var AUTOPILOT                = true    // automatically make recommended moves
var COMMENTARY               = false   // displays recommended moves for the opponent
var SEARCH_TIME              = 800     // default interface search time (ms)
var MOVE_ORDERING            = true    // sort moves based on a heuristic (reduces nodes searched)
var MOVE_ORDERING_ALGORITHM  = 'RADIX' // can be 'RADIX' or 'BUILTIN' (in general, radix is faster)
var OPENING_BOOK             = true    // use opening book
var TRANSPOSITION_TABLE      = true    // use a transposition table
var TRANSPOSITION_TABLE_SIZE = 25      // log2(maximum number of entries in transposition table)
var LATE_MOVE_REDUCTIONS     = true    // only search the first few moves of each candidate move list at full depth
var CHECK_EXTENSIONS         = true    // never evaluate leaf nodes where either side is in check
var PANIC                    = true    // only performs depth 3 searches when clock drops below 10 seconds

var start = Date.now()
console.log('Initializing:')

console.log('- board constants')
var SQUARES = [
  'a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1', '', '', '', '', '', '', '', '',
  'a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2', '', '', '', '', '', '', '', '',
  'a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'g3', 'h3', '', '', '', '', '', '', '', '',
  'a4', 'b4', 'c4', 'd4', 'e4', 'f4', 'g4', 'h4', '', '', '', '', '', '', '', '',
  'a5', 'b5', 'c5', 'd5', 'e5', 'f5', 'g5', 'h5', '', '', '', '', '', '', '', '',
  'a6', 'b6', 'c6', 'd6', 'e6', 'f6', 'g6', 'h6', '', '', '', '', '', '', '', '',
  'a7', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7', '', '', '', '', '', '', '', '',
  'a8', 'b8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8', '', '', '', '', '', '', '', ''
]
var SQ_IDS = {'a1':0|0,'b1':1|0,'c1':2|0,'d1':3|0,'e1':4|0,'f1':5|0,'g1':6|0,'h1':7|0,'a2':16|0,'b2':17|0,'c2':18|0,'d2':19|0,'e2':20|0,'f2':21|0,'g2':22|0,'h2':23|0,'a3':32|0,'b3':33|0,'c3':34|0,'d3':35|0,'e3':36|0,'f3':37|0,'g3':38|0,'h3':39|0,'a4':48|0,'b4':49|0,'c4':50|0,'d4':51|0,'e4':52|0,'f4':53|0,'g4':54|0,'h4':55|0,'a5':64|0,'b5':65|0,'c5':66|0,'d5':67|0,'e5':68|0,'f5':69|0,'g5':70|0,'h5':71|0,'a6':80|0,'b6':81|0,'c6':82|0,'d6':83|0,'e6':84|0,'f6':85|0,'g6':86|0,'h6':87|0,'a7':96|0,'b7':97|0,'c7':98|0,'d7':99|0,'e7':100|0,'f7':101|0,'g7':102|0,'h7':103|0,'a8':112|0,'b8':113|0,'c8':114|0,'d8':115|0,'e8':116|0,'f8':117|0,'g8':118|0,'h8':119}

console.log('- piece & move constants')
// bitfields for pieces (1 byte/piece): (msb) pawn knight bishop rook queen king black white (lsb)
var EE = 0x00|0,
  WP = 0x81|0, WN = 0x41|0, WB = 0x21|0, WR = 0x11|0, WQ = 0x09|0, WK = 0x05|0,
  BP = 0x82|0, BN = 0x42|0, BB = 0x22|0, BR = 0x12|0, BQ = 0x0A|0, BK = 0x06|0,
  PAWN = 0x20|0, KNIGHT = 0x10|0, BISHOP = 0x08|0, ROOK = 0x04|0, QUEEN = 0x02|0, KING = 0x01|0
var PIECE_NAMES = {0x20: 'p', 0x10: 'n', 0x08: 'b', 0x04: 'r', 0x02: 'q', 0x01: 'k'}
var PIECES = new Uint32Array([WP, WN, WB, WR, WQ, WK, BP, BN, BB, BR, BQ, BK])
var SLIDER_MASK = 0x38|0, COLOR_MASK = 0x3|0
// bitfields for moves (4 bytes/move): (msb) ep(1) promotion(7) capture(8) ooo(1) to(7) oo(1) from(7)
var PROMOTION_MASK = 0x7F000000|0,
      CAPTURE_MASK = 0x00FF0000|0,
           TO_MASK = 0x00007F00|0,
         FROM_MASK = 0x0000007F|0,
           EP_MASK = 0x80000000|0,
       CASTLE_MASK = 0x00008080|0,
           OO_MASK = 0x00000080|0,
          OOO_MASK = 0x00008000|0
var CASTLE_MASKS_SINGLE = new Uint32Array([ // masks away castle flags during make()
  0xD, 0xF, 0xF, 0xF, 0xC, 0xF, 0xF, 0xE, 0,0,0,0,0,0,0,0,
  0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0,0,0,0,0,0,0,0,
  0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0,0,0,0,0,0,0,0,
  0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0,0,0,0,0,0,0,0,
  0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0,0,0,0,0,0,0,0,
  0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0,0,0,0,0,0,0,0,
  0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0xF, 0,0,0,0,0,0,0,0,
  0x7, 0xF, 0xF, 0xF, 0x3, 0xF, 0xF, 0xB, 0,0,0,0,0,0,0,0
])
var CASTLE_MASKS = new Uint32Array(Math.pow(CASTLE_MASKS_SINGLE.length, 2)).map( // masks away castle flags during make()
  (e, i) => CASTLE_MASKS_SINGLE[i >> 7] & CASTLE_MASKS_SINGLE[i & 0b1111111]
)

console.log('- transposition table')
var TRANSPOSITION_TABLE_SIZE = 1 << TRANSPOSITION_TABLE_SIZE
var TRANSPOSITION_TABLE_MASK = TRANSPOSITION_TABLE_SIZE - 1
var ZOBRIST_GENERATOR = e => (4294967296 * Math.random())
var ZOBRIST_KEYS = new Int32Array(2 * 256 * 128).map((e, i) => i & (255 << 7) ? ZOBRIST_GENERATOR() : 0)
var ZOBRIST_TURN = new Int32Array(2).map(ZOBRIST_GENERATOR)
var ZOBRIST_CASTLING = new Int32Array(2 * 16).map(ZOBRIST_GENERATOR)
var ZOBRIST_EP = new Int32Array(2 * 128).map(ZOBRIST_GENERATOR)

console.log('- time management')
var TIME_UP_SCORE = (1 << 30)|0

console.log('- board')
var MAX_LEN = 512|0 // please don't play extra long games
var MAX_MOVE_SHIFT = 8|0 // log2(arbitrary max branching factor)
var MAX_MOVE_SCORE = 128|0 // highest possible score for a move (used in move ordering)
var MATE_SCORE = (1 << 29)|0
var map0x88 = new Uint32Array(64).map((e, i) => i + (i & ~7))
var initial_mailbox = [
  WR, WN, WB, WQ, WK, WB, WN, WR, 0,0,0,0,0,0,0,0,
  WP, WP, WP, WP, WP, WP, WP, WP, 0,0,0,0,0,0,0,0,
  EE, EE, EE, EE, EE, EE, EE, EE, 0,0,0,0,0,0,0,0,
  EE, EE, EE, EE, EE, EE, EE, EE, 0,0,0,0,0,0,0,0,
  EE, EE, EE, EE, EE, EE, EE, EE, 0,0,0,0,0,0,0,0,
  EE, EE, EE, EE, EE, EE, EE, EE, 0,0,0,0,0,0,0,0,
  BP, BP, BP, BP, BP, BP, BP, BP, 0,0,0,0,0,0,0,0,
  BR, BN, BB, BQ, BK, BB, BN, BR, 0,0,0,0,0,0,0,0
]
var mailbox = Uint8Array.from(initial_mailbox)
var kings = new Uint32Array([SQ_IDS['e1'], SQ_IDS['e8']])
var turn = 0|0 // (0,1) = (w,b)
var moves = 0|0
var fifty = 0|0 // moves since last pawn move or capture
var fiftys = new Uint32Array(MAX_LEN)
var castling = 0xF|0 // (msb) BQ BK WQ WK (lsb)
var castlings = new Uint32Array(MAX_LEN)
var ep = -1|0
var eps = new Uint32Array(MAX_LEN)
var score = 0|0
var scores = new Uint32Array(MAX_LEN)
var hash = new Int32Array([0, 0])
var hashs = new Int32Array(MAX_LEN * 2)
var make_pieces = new Uint8Array(MAX_LEN * 4) // pieces in old mailbox state before make
var make_squares = new Uint8Array(MAX_LEN * 4) // indices of those pieces
var tt = new Int32Array(5 * TRANSPOSITION_TABLE_SIZE) // transposition table (4 slots: hash (2 dwords), last found best move, score, depth)

var radix_scores = new Uint8Array(1 << MAX_MOVE_SHIFT) // holds scores for each move in sort()
var radix_counts = new Uint8Array(MAX_MOVE_SCORE) // holds score-indexed counts in sort()
var radix_swap_space = new Uint32Array(1 << MAX_MOVE_SHIFT) // holds a copy of candidate moves in sort()
var move_list = new Uint32Array(MAX_LEN * (1 << MAX_MOVE_SHIFT)) // candidate moves for each ply
var move_list_max = new Uint32Array(MAX_LEN) // number of candidate moves for each ply

console.log('- movegen constants')
// piece deltas (used in move generation and attack checking)
var deltas = new Int32Array(16 * 256)
// white PIECES
deltas.set([15, 17], 16*WP)
deltas.set([-33, -31, -14, 18, 33, 31, 14, -18], 16*WN)
deltas.set([-17, -15, 17, 15], 16*WB)
deltas.set([-1, -16, 1, 16], 16*WR)
deltas.set([-17, -15, 17, 15, -1, -16, 1, 16], 16*WQ)
deltas.set([-17, -15, 17, 15, -1, -16, 1, 16], 16*WK)
// black PIECES
deltas.set([-15, -17], 16*BP)
deltas.set([-33, -31, -14, 18, 33, 31, 14, -18], 16*BN)
deltas.set([-17, -15, 17, 15], 16*BB)
deltas.set([-1, -16, 1, 16], 16*BR)
deltas.set([-17, -15, 17, 15, -1, -16, 1, 16], 16*BQ)
deltas.set([-17, -15, 17, 15, -1, -16, 1, 16], 16*BK)

console.log('- evaluation tables')
var materials = new Int32Array(256)
materials[WP] = 66
materials[WN] = 298
materials[WB] = 322
materials[WR] = 500
materials[WQ] = 986
materials[WK] = 20000
materials[BP] = -66
materials[BN] = -298
materials[BB] = -322
materials[BR] = -500
materials[BQ] = -986
materials[BK] = -20000
// piece-square tables (used in evaluation)
var eval_table = new Int32Array(2 * 256 * 128) // 256 KB
eval_table.set([
   0,  0,  0,  0,  0,  0,  0,  0, 0,0,0,0,0,0,0,0,
   5, 10, 10,-20,-20, 10, 10,  5, 0,0,0,0,0,0,0,0,
   5, -5,-10,  0,  0,-10, -5,  5, 0,0,0,0,0,0,0,0,
   0,  0,  0, 20, 20,  0,  0,  0, 0,0,0,0,0,0,0,0,
   5,  5, 10, 25, 25, 10,  5,  5, 0,0,0,0,0,0,0,0,
  10, 10, 20, 30, 30, 20, 10, 10, 0,0,0,0,0,0,0,0,
  50, 50, 50, 50, 50, 50, 50, 50, 0,0,0,0,0,0,0,0,
   0,  0,  0,  0,  0,  0,  0,  0, 0,0,0,0,0,0,0,0
], 128*WP)
eval_table.set([
  -50,-40,-30,-30,-30,-30,-40,-50, 0,0,0,0,0,0,0,0,
  -40,-20,  0,  0,  0,  0,-20,-40, 0,0,0,0,0,0,0,0,
  -30,  5, 10, 15, 15, 10,  5,-30, 0,0,0,0,0,0,0,0,
  -30,  0, 15, 20, 20, 15,  0,-30, 0,0,0,0,0,0,0,0,
  -30,  5, 15, 20, 20, 15,  5,-30, 0,0,0,0,0,0,0,0,
  -30,  0, 10, 15, 15, 10,  0,-30, 0,0,0,0,0,0,0,0,
  -40,-20,  0,  5,  5,  0,-20,-40, 0,0,0,0,0,0,0,0,
  -50,-40,-30,-30,-30,-30,-40,-50, 0,0,0,0,0,0,0,0
], 128*WN)
eval_table.set([
  -20,-10,-10,-10,-10,-10,-10,-20, 0,0,0,0,0,0,0,0,
  -10,  0,  0,  0,  0,  0,  0,-10, 0,0,0,0,0,0,0,0,
  -10, 10, 10, 10, 10, 10, 10,-10, 0,0,0,0,0,0,0,0,
  -10,  0, 10, 10, 10, 10,  0,-10, 0,0,0,0,0,0,0,0,
  -10,  5,  5, 10, 10,  5,  5,-10, 0,0,0,0,0,0,0,0,
  -10,  5,  0,  0,  0,  0,  5,-10, 0,0,0,0,0,0,0,0,
  -10,  0,  5, 10, 10,  5,  0,-10, 0,0,0,0,0,0,0,0,
  -20,-10,-10,-10,-10,-10,-10,-20, 0,0,0,0,0,0,0,0
], 128*WB)
eval_table.set([
   0,  0,  0,  5,  5,  0,  0,  0, 0,0,0,0,0,0,0,0,
  -5,  0,  0,  0,  0,  0,  0, -5, 0,0,0,0,0,0,0,0,
  -5,  0,  0,  0,  0,  0,  0, -5, 0,0,0,0,0,0,0,0,
  -5,  0,  0,  0,  0,  0,  0, -5, 0,0,0,0,0,0,0,0,
  -5,  0,  0,  0,  0,  0,  0, -5, 0,0,0,0,0,0,0,0,
  -5,  0,  0,  0,  0,  0,  0, -5, 0,0,0,0,0,0,0,0,
   5, 10, 10, 10, 10, 10, 10,  5, 0,0,0,0,0,0,0,0,
   0,  0,  0,  0,  0,  0,  0,  0, 0,0,0,0,0,0,0,0
], 128*WR)
eval_table.set([
  -20,-10,-10, -5, -5,-10,-10,-20, 0,0,0,0,0,0,0,0,
  -10,  0,  0,  0,  0,  0,  0,-10, 0,0,0,0,0,0,0,0,
  -10,  0,  5,  5,  5,  5,  0,-10, 0,0,0,0,0,0,0,0,
   -5,  0,  5,  5,  5,  5,  0, -5, 0,0,0,0,0,0,0,0,
   -5,  0,  5,  5,  5,  5,  0, -5, 0,0,0,0,0,0,0,0,
  -10,  0,  5,  5,  5,  5,  0,-10, 0,0,0,0,0,0,0,0,
  -10,  0,  0,  0,  0,  0,  0,-10, 0,0,0,0,0,0,0,0,
  -20,-10,-10, -5, -5,-10,-10,-20, 0,0,0,0,0,0,0,0
], 128*WQ)
eval_table.set([
   20, 30, 10,  0,  0, 10, 30, 20, 0,0,0,0,0,0,0,0,
   20, 20,  0,  0,  0,  0, 20, 20, 0,0,0,0,0,0,0,0,
  -10,-20,-20,-20,-20,-20,-20,-10, 0,0,0,0,0,0,0,0,
  -30,-40,-40,-50,-50,-40,-40,-30, 0,0,0,0,0,0,0,0,
  -30,-40,-40,-50,-50,-40,-40,-30, 0,0,0,0,0,0,0,0,
  -20,-30,-30,-40,-40,-30,-30,-20, 0,0,0,0,0,0,0,0,
  -30,-40,-40,-50,-50,-40,-40,-30, 0,0,0,0,0,0,0,0,
  -30,-40,-40,-50,-50,-40,-40,-30, 0,0,0,0,0,0,0,0
], 128*WK)
for (var i = 0; i < 6; ++i) // set up endgame piece-square tables for white
  for (var j = 0; j < 128; ++j)
    eval_table[128*(PIECES[i]+256) + j] = eval_table[128*PIECES[i] + j]
// king endgame-tables are different
eval_table.set([
  -50,-40,-30,-20,-20,-30,-40,-50, 0,0,0,0,0,0,0,0,
  -30,-20,-10,  0,  0,-10,-20,-30, 0,0,0,0,0,0,0,0,
  -30,-10, 20, 30, 30, 20,-10,-30, 0,0,0,0,0,0,0,0,
  -30,-10, 30, 40, 40, 30,-10,-30, 0,0,0,0,0,0,0,0,
  -30,-10, 30, 40, 40, 30,-10,-30, 0,0,0,0,0,0,0,0,
  -30,-10, 20, 30, 30, 20,-10,-30, 0,0,0,0,0,0,0,0,
  -30,-30,  0,  0,  0,  0,-30,-30, 0,0,0,0,0,0,0,0,
  -50,-30,-30,-30,-30,-30,-30,-50, 0,0,0,0,0,0,0,0
], 128*(WK + 256))
// make negated & mirrored copy of tables for black
for (var i = 6; i < 12; ++i) {
  for (var r = 0; r < 8; ++r) {
    for (var f = 0; f < 8; ++f) {
      eval_table[128*PIECES[i] + 16*r + f] = -eval_table[128*PIECES[i-6] + 16*(7-r) + f]
      eval_table[128*(PIECES[i]+256) + 16*r + f] = -eval_table[128*(PIECES[i-6]+256) + 16*(7-r) + f]
    }
  }
}
// add piece values to piece-square tables
for (var i = 0; i < 12; ++i) {
  for (var r = 0; r < 8; ++r) {
    for (var f = 0; f < 8; ++f) {
      eval_table[128*PIECES[i] + 16*r + f] += materials[PIECES[i]]
      eval_table[128*(PIECES[i]+256) + 16*r + f] += materials[PIECES[i]]
    }
  }
}

console.log('- opening book')
var book_entries = `b1c3g8f6d2d4d7d6c1g5b8d7e2e4g7g6f2f4h7h6g5h4f6h5g1e2g6g5f4g5e7e6e2g3h5f4.
b1c3g8f6d2d4d7d6e2e4g7g6f1c4f8g7f2f4c7c5d4c5d8a5c1d2a5c5d1e2e8g8e1c1c8g4g1f3b8d7.
b1c3g8f6e2e4d7d6d2d4g7g6f1c4f8g7g1f3e8g8e4e5d6e5d4e5d8d1c3d1f6g4c1f4b8c6e5e6c8e6.
b1c3g8f6g1f3g7g6d2d4d7d6e2e4f8g7f1e2e8g8h2h3c7c5d4c5d8a5e1g1a5c5c1e3c5a5f3d4a7a6.
b1c3g8f6g1f3g7g6e2e4d7d6d2d4f8g7f1e2e8g8c1f4b8c6d4d5e7e5f4g5c6e7d1d2f6h5e1c1.
b2b3e7e5c1b2b8c6c2c4g8f6b1c3d7d5c4d5f6d5g1f3d5c3b2c3f8d6d2d3e8g8e2e3d8e7f1e2c8d7.
b2b3e7e5c1b2b8c6c2c4g8f6e2e3d7d5c4d5f6d5g1f3f8d6d2d3e8g8a2a3d8e7.
b2b3e7e5c1b2b8c6c2c4g8f6g1f3e5e4f3d4f8c5.
b2b3e7e5c1b2b8c6e2e3d7d5f1b5f8d6f2f4d8h4g2g3h4e7g1f3c8g4.
b2b3e7e5c1b2b8c6g1f3e5e4f3d4c6d4b2d4g8f6e2e3d7d5.
b2b4e7e5c1b2f7f6b4b5d7d5e2e3c8e6g1f3c7c5c2c4d5d4d2d3g8h6e3e4g7g6g2g3d8c8f1g2e6h3.
b2b4e7e5c1b2f7f6e2e4f8b4f1c4g8e7d1h5g7g6h5h4e7c6f2f4d8e7a2a3b4a5g1e2.
b2b4e7e5c1b2f7f6e2e4f8b4f1c4g8e7d1h5g7g6h5h4e7c6f2f4d8e7f4f5g6f5h4h5e8d8.
b2b4e7e5c1b2f7f6e2e4f8b4f1c4g8e7f2f4d7d5e4d5e5f4d1f3b4d6g1e2e7g6d2d4d8e7b2c1c8f5.
b2b4e7e5c1b2f7f6e2e4f8b4f1c4g8e7f2f4d7d5e4d5e5f4d1f3b4d6g1e2e7g6d2d4e8g8b2c1c8f5.
c2c4b7b6b1c3c7c5g1f3c8b7d2d4c5d4f3d4g8f6f2f3b8c6e2e4e7e6c1e3f8c5d1d2e8g8e1c1d8e7.
c2c4b7b6b1c3e7e6g1f3c8b7g2g3f7f5f1g2g8f6e1g1f8b4d1b3b4c3b3c3e8g8b2b4a7a5b4b5d8e7.
c2c4b7b6e2e4c8b7b1c3e7e5d2d3b8c6g2g3f8c5f1g2g8e7g1f3e8g8e1g1a7a5c1e3d7d6d3d4e5d4.
c2c4b8c6g2g3e7e5f1g2g7g6b1c3f8g7e2e3d7d6g1e2g8e7a1b1a7a5a2a3c8e6c3d5e7f5b2b4a5b4.
c2c4c7c5b1c3b8c6g1f3e7e5e2e3g8f6d2d4e5d4e3d4c5d4f3d4f8e7d4c6d7c6f1e2d8d1e2d1c8f5.
c2c4c7c5b1c3b8c6g1f3g7g6e2e3g8f6d2d4c5d4e3d4d7d5c4d5f6d5d1b3d5c3f1c4e7e6b2c3f8g7.
c2c4c7c5b1c3b8c6g1f3g8f6g2g3g7g6f1g2f8g7e1g1e8g8d2d4c5d4f3d4c6d4d1d4d7d6c1g5c8e6.
c2c4c7c5b1c3g8f6e2e4b8c6g1f3e7e6d2d3d7d6f1e2f8e7e1g1e8g8d3d4c5d4f3d4d8c7d4b5c7b8.
c2c4c7c5b1c3g8f6g2g3d7d5c4d5f6d5f1g2e7e6c3d5e6d5d1b3b8c6b3d5d8d5g2d5c6b4d5e4f7f5.
c2c4c7c5g1f3b8c6b1c3g8f6e2e3e7e6d2d4d7d5a2a3a7a6b2b3c5d4e3d4f8e7c4c5b7b6c5b6f6d7.
c2c4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d5c4d5f6d5d4c6b7c6c1d2e7e6g2g3f8e7f1g2e8g8.
c2c4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3e7e6c1f4f8b4d4b5e8g8f4c7d8e7c7d6b4d6d1d6e7d8.
c2c4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3e7e6d4b5f8b4c1f4e8g8f4c7d8e7c7d6b4d6d1d6e7d8.
c2c4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3e7e6d4b5f8b4c1f4e8g8f4d6b4d6b5d6d8b6d1d2f6e8.
c2c4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3e7e6d4b5f8b4c1f4e8g8f4d6b4d6b5d6f6e8a2a3b7b6.
c2c4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3e7e6d4b5f8b4c1f4e8g8f4d6b4d6b5d6f6e8d1d2e8d6.
c2c4c7c5g1f3b8c6g2g3g7g6f1g2f8g7b1c3d7d6e1g1g8h6a2a3e8g8a1b1a8b8b2b4h6f5e2e3c8d7.
c2c4c7c5g1f3f7f5d2d4c5d4f3d4g7g6g2g3f8g7f1g2b8c6d4b5g8f6b5c3e8g8e1g1b7b6b2b3c8b7.
c2c4c7c5g1f3g7g6d2d4c5d4f3d4b8c6e2e4g8f6b1c3d7d6f1e2c6d4d1d4f8g7c1g5h7h6g5e3e8g8.
c2c4c7c5g1f3g7g6d2d4c5d4f3d4b8c6e2e4g8f6b1c3d7d6f2f3c6d4d1d4f8g7c1e3e8g8d4d2d8a5.
c2c4c7c5g1f3g7g6d2d4c5d4f3d4f8g7e2e4b8c6c1e3g8f6b1c3f6g4d1g4c6d4g4d1d4e6a1c1e8g8.
c2c4c7c5g1f3g7g6d2d4c5d4f3d4f8g7e2e4g8f6b1c3b8c6c1e3f6g4d1g4c6d4g4d1d4e6d1d2d7d6.
c2c4c7c5g1f3g7g6e2e4b8c6d2d4c5d4f3d4g8f6b1c3c6d4d1d4d7d6f1e2f8g7e1g1e8g8d4e3c8e6.
c2c4c7c5g1f3g8f6b1c3b7b6e2e4b8c6d2d4c5d4f3d4c8b7c1g5d8b8d4c6b7c6f1d3e7e6e1g1f8b4.
c2c4c7c5g1f3g8f6b1c3b8c6d2d4c5d4f3d4e7e6d4b5d7d5c1f4e6e5c4d5e5f4d5c6b7c6d1d8e8d8.
c2c4c7c5g1f3g8f6b1c3b8c6d2d4c5d4f3d4e7e6d4b5d7d5c1f4e6e5c4d5e5f4d5c6b7c6d1d8e8d8.
c2c4c7c5g1f3g8f6b1c3b8c6d2d4c5d4f3d4e7e6d4b5d7d5c1f4e6e5c4d5e5f4d5c6b7c6d1d8e8d8.
c2c4c7c5g1f3g8f6b1c3b8c6d2d4c5d4f3d4e7e6d4b5d7d5c4d5f6d5e2e4d5c3d1d8e8d8b5c3f8c5.
c2c4c7c5g1f3g8f6b1c3b8c6d2d4c5d4f3d4e7e6e2e3f8e7f1e2e8g8e1g1d7d6b2b3a7a6c1b2c8d7.
c2c4c7c5g1f3g8f6b1c3b8c6d2d4c5d4f3d4e7e6g2g3d8b6d4b3c6e5e2e4f8b4d1e2e8g8f2f4e5c6.
c2c4c7c5g1f3g8f6b1c3b8c6d2d4c5d4f3d4e7e6g2g3d8b6d4b3c6e5e2e4f8b4d1e2e8g8f2f4e5c6.
c2c4c7c5g1f3g8f6b1c3b8c6d2d4c5d4f3d4e7e6g2g3d8b6d4b3f8b4f1g2b6a6b3d2b4c3b2c3e8g8.
c2c4c7c5g1f3g8f6b1c3b8c6d2d4c5d4f3d4e7e6g2g3f8c5d4b3c5b4f1g2d7d5c4d5f6d5a2a3b4c3.
c2c4c7c5g1f3g8f6b1c3d7d5c4d5f6d5d2d4d5c3b2c3g7g6e2e3f8g7f1d3e8g8e1g1d8c7a1b1b7b6.
c2c4c7c5g1f3g8f6b1c3d7d5c4d5f6d5e2e4d5b4f1c4b4d3e1e2d3f4e2f1f4e6b2b4c5b4c3d5g7g6.
c2c4c7c5g1f3g8f6b1c3e7e6e2e3b8c6d2d4d7d5c4d5e6d5f1b5f8d6d4c5d6c5e1g1e8g8b2b3c8g4.
c2c4c7c5g1f3g8f6b1c3e7e6e2e3b8c6d2d4d7d5c4d5e6d5f1b5f8d6f3e5d8c7e5c6b7c6d4c5d6c5.
c2c4c7c5g1f3g8f6b1c3e7e6e2e3d7d5d2d4b8c6c4d5e6d5f1b5f8d6d4c5d6c5e1g1e8g8b2b3c8e6.
c2c4c7c5g1f3g8f6b1c3e7e6g2g3b7b6f1g2c8b7e1g1f8e7b2b3e8g8c1b2d7d5c4d5f6d5d1c2b8c6.
c2c4c7c5g1f3g8f6b1c3e7e6g2g3b7b6f1g2c8b7e1g1f8e7d2d4c5d4d1d4b8c6d4f4e8g8f1d1d8b8.
c2c4c7c5g1f3g8f6b1c3e7e6g2g3b7b6f1g2c8b7e1g1f8e7d2d4c5d4d1d4e8g8f1d1b8c6d4f4e7b4.
c2c4c7c5g1f3g8f6b1c3e7e6g2g3b7b6f1g2c8b7e1g1f8e7f1e1d7d5c4d5f6d5e2e4d5b4d2d4c5d4.
c2c4c7c5g1f3g8f6b1c3e7e6g2g3b8c6f1g2d7d5c4d5f6d5e1g1f8e7d2d4e8g8c3d5e6d5d4c5e7c5.
c2c4c7c5g1f3g8f6b1c3e7e6g2g3b8c6f1g2d7d5c4d5f6d5e1g1f8e7d2d4e8g8e2e4d5b4a2a3c5d4.
c2c4c7c5g1f3g8f6b1c3e7e6g2g3b8c6f1g2d7d5c4d5f6d5e1g1f8e7d2d4e8g8e2e4d5c3b2c3c5d4.
c2c4c7c5g1f3g8f6b1c3e7e6g2g3d7d5c4d5f6d5f1g2b8c6e1g1f8e7d2d4e8g8c3d5e6d5d4c5e7c5.
c2c4c7c5g1f3g8f6b2b3g7g6c1b2f8g7e2e3e8g8f1e2b8c6e1g1b7b6d2d4c5d4f3d4c8b7e2f3d7d5.
c2c4c7c5g1f3g8f6d2d4c5d4f3d4e7e6g2g3d7d5f1g2e6e5d4c2d5d4e1g1b8c6b1d2c8g4d2f3a7a5.
c2c4c7c5g1f3g8f6d2d4c5d4f3d4g7g6b1c3d7d5c1g5d5c4e2e3d8a5g5f6e7f6f1c4f8b4a1c1a7a6.
c2c4c7c5g1f3g8f6g2g3b7b6f1g2c8b7e1g1e7e6b2b3f8e7c1b2e8g8b1c3d7d5e2e3b8d7d1e2d8c7.
c2c4c7c5g1f3g8f6g2g3b7b6f1g2c8b7e1g1e7e6b2b3f8e7c1b2e8g8e2e3d7d5d1e2b8c6f1d1a8c8.
c2c4c7c5g1f3g8f6g2g3b7b6f1g2c8b7e1g1g7g6d2d4c5d4d1d4f8g7b1c3b8c6d4h4h7h6c3d5e7e6.
c2c4c7c5g1f3g8f6g2g3g7g6f1g2f8g7e1g1e8g8d2d4c5d4f3d4b8c6b1c3d7d6d4c2h7h5c1g5c8e6.
c2c4c7c5g2g3b8c6f1g2g8f6g1f3e7e6e1g1d7d5c4d5e6d5d2d4f8e7b1c3e8g8c1f4c5d4f3d4d8b6.
c2c4c7c5g2g3b8c6g1f3e7e5b1c3g7g6f1g2f8g7e1g1g8e7f3e1d7d6e1c2c8e6d2d3d6d5b2b3e8g8.
c2c4c7c5g2g3b8c6g1f3g7g6d2d4c5d4f3d4f8g7d4c2g8f6f1g2e8g8b1c3d7d6e1g1c8d7b2b3d8c8.
c2c4c7c5g2g3g7g6f1g2f8g7b1c3b8c6a2a3a7a6a1b1a8b8b2b4c5b4a3b4b7b5c4b5a6b5g1f3d7d5.
c2c4c7c5g2g3g7g6f1g2f8g7b1c3b8c6a2a3d7d6e2e3g8f6g1e2e8g8e1g1c8f5e3e4f5g4f2f3g4d7.
c2c4c7c5g2g3g7g6f1g2f8g7b1c3b8c6e2e4e7e5g1e2g8e7a2a3d7d6a1b1a7a5e1g1e8g8d2d3a8b8.
c2c4c7c5g2g3g7g6f1g2f8g7b1c3g8f6b2b3e8g8c1b2b8c6g1f3e7e5e1g1d7d6d2d3h7h6e2e3c8e6.
c2c4c7c6d2d4d7d5b1c3g8f6e2e3a7a6g1f3b7b5b2b3c8g4f1e2e7e6f3e5g4e2d1e2f8e7e1g1e8g8.
c2c4c7c6d2d4d7d5b1c3g8f6e2e3a7a6g1f3b7b5b2b3c8g4f1e2e7e6h2h3g4f3e2f3f8e7e1g1e8g8.
c2c4c7c6d2d4d7d5b1c3g8f6g1f3e7e6e2e3b8d7d1c2b7b6f1d3c8b7e1g1f8e7b2b3d8c7c1b2a8d8.
c2c4c7c6d2d4d7d5b1c3g8f6g1f3e7e6e2e3b8d7d1c2b7b6f1d3c8b7e1g1f8e7b2b3d8c7c1b2h7h6.
c2c4c7c6d2d4d7d5c4d5c6d5c1f4b8c6e2e3g8f6b1c3a7a6f1d3c8g4g1e2e7e6e1g1f8d6f2f3.
c2c4c7c6d2d4d7d5e2e3e7e6b1c3f7f5g1f3f8d6f1d3g8h6f3e5d8h4g2g3h4f6f2f4d6e5d4e5f6e7.
c2c4c7c6d2d4d7d5g1f3g8f6b1c3d5c4a2a4c8f5e2e3e7e6f1c4f8b4e1g1e8g8d1e2b8d7e3e4f5g6.
c2c4c7c6d2d4d7d5g1f3g8f6b1c3e7e6c1g5d5c4e2e4b7b5e4e5h7h6g5h4g7g5f3g5h6g5h4g5b8d7.
c2c4c7c6e2e4d7d5e4d5c6d5d2d4g8f6b1c3e7e6g1f3f8b4f1d3d5c4d3c4e8g8e1g1b7b6c1g5c8b7.
c2c4c7c6g1f3d7d5b2b3c8g4e2e3b8d7c1b2e7e6f1e2g8f6e1g1f8d6d2d3e8g8d1c2d8e7f1d1e6e5.
c2c4c7c6g1f3d7d5d2d4g8f6b1c3e7e6e2e3b8d7f1d3d5c4d3c4b7b5c4e2b5b4c3a4c8b7e1g1f8e7.
c2c4c7c6g1f3d7d5e2e3g8f6b1c3a7a6h2h3b7b5b2b3b8d7d2d4e7e6f1d3f8b4c1d2b5c4b3c4d5c4.
c2c4c7c6g1f3d7d5e2e3g8f6b1c3e7e6b2b3b8d7c1b2e6e5d2d4e5e4f3d2f8e7a2a3e8g8b3b4f8e8.
c2c4c7c6g1f3d7d5e2e3g8f6b1c3e7e6b2b3b8d7c1b2f8e7d2d4e8g8f1d3b7b6e1g1c8b7d1e2d8c7.
c2c4e7e5a2a3g8f6d2d3c7c6g1f3g7g6b1c3d7d6g2g3f8g7f1g2e8g8e1g1d8e7e2e4h7h6d3d4c8g4.
c2c4e7e5b1c3b8c6g1f3f7f5d2d4e5e4f3d2g8f6e2e3g7g6a2a3f8g7b2b4e8g8g2g3d7d6d2b3d8e7.
c2c4e7e5b1c3b8c6g1f3g8f6g2g3c6d4f1g2d4f3g2f3f8c5e1g1e8g8e2e3c5b4f3g2b4c3b2c3c7c6.
c2c4e7e5b1c3b8c6g2g3g7g6f1g2d7d6a1b1c8f5d2d3d8d7b2b4f8g7b4b5c6d8c3d5c7c6b5c6b7c6.
c2c4e7e5b1c3b8c6g2g3g7g6f1g2f8g7e2e3d7d6g1e2f7f5d2d4e5e4b2b4g8f6a1b1c6e7f2f3e4f3.
c2c4e7e5b1c3b8c6g2g3g7g6f1g2f8g7e2e3d7d6g1e2g8f6e1g1e8g8d2d3c8e6c3d5d8d7f1e1a8b8.
c2c4e7e5b1c3b8c6g2g3g7g6f1g2f8g7e2e3g8e7g1e2e8g8e1g1d7d6a2a3c8e6c3d5d8d7d2d3e7f5.
c2c4e7e5b1c3b8c6g2g3g7g6f1g2f8g7e2e4d7d6g1e2g8e7d2d3e8g8e1g1c8e6h2h3d8d7g1h2f7f5.
c2c4e7e5b1c3d7d6d2d4e5d4d1d4b8c6d4d2g8f6b2b3a7a5e2e4a5a4a1b1a4b3a2b3g7g6g2g3f8g7.
c2c4e7e5b1c3d7d6g1f3c8g4e2e3g8f6f1e2c7c6h2h3g4h5e1g1f8e7d2d3e8g8b2b3b8d7f3h4h5e2.
c2c4e7e5b1c3d7d6g1f3c8g4e2e3g8f6f1e2f8e7h2h3g4h5d2d4b8d7e1g1c7c6b2b3e8g8c1b2f8e8.
c2c4e7e5b1c3d7d6g1f3c8g4e2e3g8f6h2h3g4f3d1f3c7c6d2d4f8e7d4d5e8g8f1d3b8a6e1g1c6d5.
c2c4e7e5b1c3d7d6g1f3f7f5d2d4e5e4f3d2c7c6e2e3g8f6f1e2g7g6e1g1f8h6b2b4e8g8b4b5f8e8.
c2c4e7e5b1c3d7d6g1f3f7f5d2d4e5e4f3g5f8e7g5h3c7c5d4c5d6c5d1d8e7d8c3b5d8a5c1d2a5d2.
c2c4e7e5b1c3d7d6g1f3g7g6d2d4b8d7g2g3f8g7f1g2g8h6e1g1e8g8e2e4c7c6b2b3f8e8c1b2f7f6.
c2c4e7e5b1c3d7d6g2g3b8c6f1g2g7g6d2d3f8g7c1d2g8e7g1f3e8g8e1g1c8d7a1b1d8c8b2b4d7h3.
c2c4e7e5b1c3d7d6g2g3c7c5f1g2b8c6a2a3g7g6b2b4f8g7a1b1g8e7e2e3e8g8d2d3a8b8g1e2c8e6.
c2c4e7e5b1c3d7d6g2g3c8e6f1g2c7c6d2d3g8f6g1f3h7h6e1g1f8e7b2b3e8g8e2e4c6c5f3h4b8c6.
c2c4e7e5b1c3d7d6g2g3f7f5f1g2b8c6d2d3g8f6e2e3f8e7g1e2e8g8e1g1d8e8f2f4e7d8a2a3a8b8.
c2c4e7e5b1c3d7d6g2g3g7g6d2d4b8c6d4d5c6e7e2e4f8g7h2h4g8f6f1e2h7h5g1h3c7c5h3g5c8d7.
c2c4e7e5b1c3d7d6g2g3g7g6d2d4b8d7f1g2f8g7g1f3g8h6c4c5e8g8c5d6c7d6e2e4e5d4f3d4d7c5.
c2c4e7e5b1c3d7d6g2g3g7g6f1g2f8g7d2d3b8c6e2e4g8e7g1e2e8g8e1g1c8e6c3d5d8d7c1e3f7f5.
c2c4e7e5b1c3d7d6g2g3g7g6f1g2f8g7g1f3g8h6d2d4b8d7e1g1e8g8e2e4c7c6b2b3f8e8h2h3f7f6.
c2c4e7e5b1c3g8f6g1f3b8c6d2d4e5d4f3d4f8b4c1g5h7h6g5h4e8g8e2e3f8e8f1e2c6e5d1b3b4a5.
c2c4e7e5b1c3g8f6g1f3b8c6d2d4e5e4f3e5f8b4c1g5h7h6g5h4d8e7e5c6b7c6e2e3e8g8f1e2d7d6.
c2c4e7e5b1c3g8f6g1f3b8c6e2e3f8b4c3d5b4e7d1c2d7d6b2b4c8e6d5e7c6e7c1b2e6f5d2d3e8g8.
c2c4e7e5b1c3g8f6g1f3b8c6g2g3c6d4f1g2d4f3g2f3f8b4d1b3b4c5d2d3e8g8e1g1c7c6f3g2f8e8.
c2c4e7e5b1c3g8f6g1f3b8c6g2g3d7d5c4d5f6d5f1g2d5b6e1g1f8e7a2a3e8g8b2b4f8e8d2d3e7f8.
c2c4e7e5b1c3g8f6g1f3b8c6g2g3d7d5c4d5f6d5f1g2d5b6e1g1f8e7d2d3e8g8a2a3c8e6c1e3f7f5.
c2c4e7e5b1c3g8f6g1f3b8c6g2g3f8b4f1g2e8g8e1g1b4c3b2c3d7d6d2d3e5e4f3d4e4d3d4c6d3e2.
c2c4e7e5b1c3g8f6g1f3b8c6g2g3f8b4f1g2e8g8e1g1e5e4f3e1b4c3d2c3d7d6e1c2f8e8c2e3h7h6.
c2c4e7e5b1c3g8f6g1f3b8c6g2g3f8b4f1g2e8g8e1g1e5e4f3e1b4c3d2c3h7h6e1c2f8e8c2e3d7d6.
c2c4e7e5b1c3g8f6g1f3b8c6g2g3f8b4f1g2e8g8e1g1e5e4f3g5b4c3b2c3f8e8f2f3e4e3d2d3d7d5.
c2c4e7e5b1c3g8f6g1f3b8c6g2g3f8b4f1g2e8g8e1g1f8e8c3d5f6d5c4d5c6d4f3d4e5d4e2e3c7c5.
c2c4e7e5b1c3g8f6g1f3b8c6g2g3f8b4f1g2e8g8e1g1f8e8d2d3b4c3b2c3e5e4f3d4h7h6d3e4f6e4.
c2c4e7e5b1c3g8f6g1f3b8c6g2g3f8b4f1g2e8g8e1g1f8e8d2d3h7h6c3d5b4f8h2h3d7d6e2e4c6d4.
c2c4e7e5b1c3g8f6g1f3b8c6g2g3f8c5f1g2d7d6d2d3a7a6c1g5h7h6g5f6d8f6e1g1f6d8a2a3c6d4.
c2c4e7e5b1c3g8f6g1f3b8c6g2g3f8c5f1g2e8g8e1g1d7d6d2d3c8e6a2a3a7a5c1g5h7h6g5h4c6d4.
c2c4e7e5b1c3g8f6g1f3b8c6g2g3f8c5f1g2e8g8e1g1d7d6d2d3h7h6a2a3a7a6b2b4c5a7c1b2c8g4.
c2c4e7e5b1c3g8f6g2g3c7c6g1f3e5e4f3d4d7d5c4d5c6d5d2d3d8b6d4b3f6g4d3d4c8e6f2f3e4f3.
c2c4e7e5b1c3g8f6g2g3d7d5c4d5f6d5f1g2d5b6g1f3b8c6e1g1f8e7a2a3c8e6b2b4e8g8a1b1f7f6.
c2c4e7e5b1c3g8f6g2g3d7d5c4d5f6d5f1g2d5b6g1f3b8c6e1g1f8e7a2a3e8g8b2b4c8e6a1b1f7f6.
c2c4e7e5b1c3g8f6g2g3f8b4f1g2e8g8d1b3b4c3b3c3f8e8d2d3d7d5c4d5f6d5c3b3d5b6b3c2b8c6.
c2c4e7e5b1c3g8f6g2g3f8b4f1g2e8g8e2e4b4c3d2c3d7d6d1e2b8d7g1f3d7c5f3h4a7a6b2b3b7b5.
c2c4e7e5b1c3g8f6g2g3f8b4f1g2e8g8g1f3f8e8e1g1e5e4f3d4b8c6d4c2b4c3d2c3c6e5b2b3d7d6.
c2c4e7e5b1c3g8f6g2g3f8c5f1g2b8c6e2e3e8g8g1e2f8e8e1g1d7d6d2d4c5b6h2h3c8d7a2a3c6e7.
c2c4e7e5g1f3e5e4f3d4b8c6d4c2g8f6b1c3f8c5b2b3e8g8g2g3d7d5c4d5c6b4c2b4c5b4f1g2f8e8.
c2c4e7e5g2g3b8c6f1g2g7g6b1c3f8g7e2e3d7d6g1e2g8e7e1g1e8g8d2d3c8g4h2h3g4e6c3d5d8d7.
c2c4e7e5g2g3b8c6f1g2g7g6b1c3f8g7e2e3d7d6g1e2g8h6a1b1c8e6d2d3e8g8b2b4d8d7h2h4f7f5.
c2c4e7e5g2g3b8c6f1g2g7g6b1c3f8g7e2e3d7d6g1e2h7h5h2h4c8g4d2d3g8f6c3d5f6d5c4d5c6e7.
c2c4e7e5g2g3b8c6f1g2g7g6b1c3f8g7e2e3g8f6g1e2e8g8e1g1d7d6d2d4e5d4e3d4f8e8h2h3h7h6.
c2c4e7e5g2g3c7c6b2b3d7d5c1b2d5d4g1f3f8d6d2d3c6c5f1g2g8e7e1g1e7c6e2e3e8g8b1d2c8e6.
c2c4e7e5g2g3d7d6b1c3f7f5f1g2g8f6e2e3f8e7g1e2c7c6d2d4e8g8e1g1b8a6a1b1a6c7b2b3e5e4.
c2c4e7e5g2g3d7d6f1g2g7g6d2d4b8d7b1c3f8g7g1f3g8f6e1g1e8g8d1c2f8e8f1d1c7c6b2b3d8e7.
c2c4e7e5g2g3g8f6f1g2b8c6b1c3d7d6e2e3c8g4g1e2d8d7h2h3g4e6c3d5e6d5c4d5c6b4d1b3c7c5.
c2c4e7e5g2g3g8f6f1g2b8c6g1f3f8c5e1g1d7d6b1c3e8g8d2d3a7a6a2a3c6d4f3d2c7c6b2b4c5a7.
c2c4e7e6b1c3c7c5g1f3g8f6g2g3b7b6f1g2c8b7e1g1f8e7d2d4c5d4d1d4d7d6b2b3e8g8c1b2a7a6.
c2c4e7e6b1c3d7d5d2d4c7c6e2e3g8f6g1f3b8d7d1c2b7b6f1d3c8b7e1g1f8e7b2b3d8c7c1b2a8c8.
c2c4e7e6b1c3d7d5d2d4f8e7c4d5e6d5c1f4c7c6e2e3c8f5g2g4f5e6h2h3g8f6g1f3e8g8f1d3c6c5.
c2c4e7e6b1c3d7d5d2d4f8e7c4d5e6d5c1f4g8f6e2e3c8f5g1e2e8g8a1c1c7c6e2g3f5e6f1d3f8e8.
c2c4e7e6b1c3d7d5d2d4f8e7g1f3g8f6c1f4e8g8e2e3c7c5d4c5e7c5a2a3b8c6d1c2c5e7a1d1d8a5.
c2c4e7e6b1c3d7d5d2d4f8e7g1f3g8f6c1f4e8g8e2e3c7c5d4c5e7c5d1c2b8c6a1d1d8a5a2a3c5e7.
c2c4e7e6b1c3d7d5d2d4f8e7g1f3g8f6c1g5e8g8e2e3b8d7d1c2h7h6g5h4c7c5a1d1c5d4f3d4d7b6.
c2c4e7e6b1c3d7d5d2d4f8e7g1f3g8f6c1g5e8g8e2e3b8d7d1c2h7h6g5h4c7c5c4d5c5d4f3d4f6d5.
c2c4e7e6b1c3d7d5d2d4f8e7g1f3g8f6c1g5e8g8e2e3h7h6g5h4b7b6a1c1c8b7h4f6e7f6c4d5e6d5.
c2c4e7e6b1c3d7d5d2d4f8e7g1f3g8f6c1g5e8g8e2e3h7h6g5h4b7b6c4d5f6d5h4e7d8e7c3d5e6d5.
c2c4e7e6b1c3d7d5d2d4f8e7g1f3g8f6c1g5e8g8e2e3h7h6g5h4b7b6c4d5f6d5h4e7d8e7c3d5e6d5.
c2c4e7e6b1c3d7d5d2d4f8e7g1f3g8f6c1g5e8g8e2e3h7h6g5h4b7b6c4d5f6d5h4e7d8e7c3d5e6d5.
c2c4e7e6b1c3d7d5d2d4f8e7g1f3g8f6c1g5h7h6g5h4b7b6a1c1e8g8c4d5f6d5c3d5e6d5h4e7d8e7.
c2c4e7e6b1c3d7d5d2d4f8e7g1f3g8f6c1g5h7h6g5h4e8g8a1c1b7b6c4d5f6d5c3d5e6d5h4e7d8e7.
c2c4e7e6b1c3d7d5d2d4f8e7g1f3g8f6c1g5h7h6g5h4e8g8a1c1d5c4e2e3c7c5f1c4c5d4e3d4b8c6.
c2c4e7e6b1c3d7d5d2d4f8e7g1f3g8f6c1g5h7h6g5h4e8g8e2e3b7b6a1c1c8b7f1e2b8d7c4d5e6d5.
c2c4e7e6b1c3d7d5d2d4f8e7g1f3g8f6c1g5h7h6g5h4e8g8e2e3b7b6a1c1c8b7f1e2d5c4e2c4b8d7.
c2c4e7e6b1c3d7d5d2d4f8e7g1f3g8f6c1g5h7h6g5h4e8g8e2e3b7b6a1c1c8b7h4f6e7f6c4d5e6d5.
c2c4e7e6b1c3d7d5d2d4f8e7g1f3g8f6c1g5h7h6g5h4e8g8e2e3b7b6f1e2c8b7h4f6e7f6c4d5e6d5.
c2c4e7e6b1c3d7d5d2d4f8e7g1f3g8f6d1c2e8g8c1g5c7c5d4c5d5c4e2e4d8a5e4e5f6d5f1c4d5c3.
c2c4e7e6b1c3d7d5d2d4g8f6c1g5f8e7e2e3h7h6g5h4e8g8g1f3b7b6c4d5f6d5h4e7d8e7c3d5e6d5.
c2c4e7e6b1c3d7d5d2d4g8f6c4d5e6d5c1g5c7c6d1c2f8e7e2e3b8d7f1d3e8g8g1e2f8e8e1g1g7g6.
c2c4e7e6b1c3d7d5d2d4g8f6c4d5e6d5c1g5f8e7e2e3e8g8f1d3b8d7g1e2f8e8e1g1d7f8d1c2c7c6.
c2c4e7e6b1c3d7d5d2d4g8f6c4d5e6d5c1g5f8e7e2e3e8g8f1d3b8d7g1f3f8e8d1c2c7c6e1g1d7f8.
c2c4e7e6b1c3d7d5d2d4g8f6c4d5e6d5c1g5f8e7e2e3e8g8f1d3c7c6d1c2b8d7g1f3f8e8h2h3d7f8.
c2c4e7e6b1c3d7d5d2d4g8f6g1f3b8d7c4d5e6d5c1f4c7c6e2e3f8e7h2h3e8g8f1d3f8e8d1c2d7f8.
c2c4e7e6b1c3d7d5d2d4g8f6g1f3f8e7c1f4e8g8e2e3b7b6c4d5e6d5f1d3c8b7h2h3c7c5e1g1b8d7.
c2c4e7e6b1c3d7d5d2d4g8f6g1f3f8e7c1g5h7h6g5h4e8g8e2e3b7b6a1c1c8b7c4d5f6d5c3d5b7d5.
c2c4e7e6b1c3f7f5d2d4g8f6c1g5f8e7g1f3e8g8h2h3d7d6e2e3b7b6f1e2d8e8d1c2h7h6g5h4g7g5.
c2c4e7e6b1c3f7f5g1f3g8f6b2b3b7b6g2g3c8b7f1g2f8b4c1b2e8g8e1g1b4c3b2c3d7d6d2d3d8e8.
c2c4e7e6b1c3f7f5g2g3g8f6f1g2f8e7d2d4e8g8g1f3d7d5e1g1c7c6b2b3f6e4c1b2b8d7e2e3e7f6.
c2c4e7e6b1c3f7f5g2g3g8f6f1g2f8e7e2e3e8g8g1e2c7c6d2d4d7d5b2b3c8d7c1b2d7e8e2f4e8f7.
c2c4e7e6b1c3g8f6d2d4f8b4e2e3c7c5g1e2d7d5a2a3b4c3e2c3c5d4e3d4d5c4f1c4b8c6c1e3e8g8.
c2c4e7e6b1c3g8f6d2d4f8b4f2f3d7d5a2a3b4c3b2c3c7c6e2e3b7b6c4d5c6d5f1b5b8d7a3a4a7a6.
c2c4e7e6b1c3g8f6g1f3d7d5d2d4f8e7c1g5e8g8d1c2b7b6g5f6e7f6e2e4b8c6e1c1d5e4c2e4c8b7.
c2c4e7e6d2d4d7d5b1c3c7c5c4d5e6d5g1f3b8c6g2g3g8f6f1g2f8e7e1g1e8g8c1g5c5d4f3d4h7h6.
c2c4e7e6d2d4d7d5b1c3c7c5c4d5e6d5g1f3b8c6g2g3g8f6f1g2f8e7e1g1e8g8c1g5c5d4f3d4h7h6.
c2c4e7e6d2d4d7d5b1c3c7c5c4d5e6d5g1f3b8c6g2g3g8f6f1g2f8e7e1g1e8g8c1g5c5d4f3d4h7h6.
c2c4e7e6d2d4d7d5b1c3f8e7g1f3g8f6c1f4c7c5d4c5b8a6e2e3a6c5c4d5e6d5f1e2e8g8e1g1c8e6.
c2c4e7e6d2d4d7d5b1c3f8e7g1f3g8f6c1g5e8g8e2e3h7h6g5f6e7f6d1d2b7b6c4d5e6d5a1d1c8e6.
c2c4e7e6d2d4d7d5b1c3f8e7g1f3g8f6c1g5h7h6g5h4e8g8a1c1f6e4h4e7d8e7e2e3c7c6d1c2e4c3.
c2c4e7e6d2d4d7d5b1c3g8f6c1g5f8e7e2e3e8g8a1c1b8d7g1f3c7c5c4d5f6d5g5e7d5e7f1e2b7b6.
c2c4e7e6d2d4d7d5b1c3g8f6c4d5e6d5c1g5c7c6e2e3c8f5d1f3f5g6g5f6d8f6f3f6g7f6e1d2b8d7.
c2c4e7e6d2d4d7d5g1f3c7c5c4d5e6d5g2g3b8c6f1g2g8f6e1g1f8e7b1c3e8g8c1g5c5d4f3d4h7h6.
c2c4e7e6d2d4d7d5g1f3c7c5c4d5e6d5g2g3b8c6f1g2g8f6e1g1f8e7b1c3e8g8c1g5c8e6d4c5e7c5.
c2c4e7e6d2d4d7d5g1f3f8e7b1c3g8f6c1g5e8g8e2e3h7h6g5f6e7f6d1d2b7b6c4d5e6d5b2b4c8b7.
c2c4e7e6d2d4d7d5g1f3g8f6c1g5f8e7e2e3e8g8c4d5e6d5b1c3b8d7f1d3b7b6e1g1c8b7a1c1c7c5.
c2c4e7e6d2d4g8f6g1f3d7d5b1c3c7c5c4d5f6d5g2g3b8c6f1g2d5c3b2c3c5d4c3d4f8b4c1d2b4e7.
c2c4e7e6g1f3d7d5b2b3f8e7c1b2e7f6b1c3c7c5c4d5e6d5d2d4c5d4f3d4g8e7g2g3e8g8f1g2b8c6.
c2c4e7e6g1f3d7d5b2b3g8f6g2g3b7b6f1g2c8b7e1g1b8d7c1b2f8e7e2e3e8g8d2d3d5c4b3c4d7c5.
c2c4e7e6g1f3d7d5d2d4g8f6b1c3f8e7c1f4e8g8e2e3c7c5d4c5b8c6c4d5e6d5f1e2e7c5e1g1c8e6.
c2c4e7e6g1f3d7d5d2d4g8f6b1c3f8e7c1g5e8g8e2e3h7h6g5h4b7b6c4d5f6d5h4e7d8e7c3d5e6d5.
c2c4e7e6g1f3d7d5d2d4g8f6b1c3f8e7c1g5h7h6g5h4e8g8a1c1b7b6c4d5e6d5e2e3c8b7f1e2b8d7.
c2c4e7e6g1f3d7d5d2d4g8f6b1c3f8e7c1g5h7h6g5h4e8g8e2e3b8d7a1c1c7c6f1d3d5c4d3c4b7b5.
c2c4e7e6g1f3d7d5e2e3g8f6b2b3g7g6c1b2f8g7d2d4e8g8f1d3c7c5e1g1c5d4f3d4e6e5d4b5a7a6.
c2c4e7e6g1f3d7d5g2g3d5d4e2e3b8c6e3d4c6d4f1g2g8h6e1g1h6f5d2d3f8e7f3d4f5d4b1d2e8g8.
c2c4e7e6g1f3g8f6b1c3b7b6e2e4c8b7d2d3d7d6g2g3g7g6f1g2f8g7e1g1e8g8f3e1f6e8d3d4c7c5.
c2c4e7e6g1f3g8f6b1c3c7c5g2g3b8c6f1g2d7d5c4d5f6d5e1g1f8e7d2d4e8g8c3d5e6d5c1e3c5c4.
c2c4e7e6g1f3g8f6b1c3d7d5d2d4f8b4c4d5e6d5c1g5h7h6g5f6d8f6d1a4b8c6e2e3e8g8f1e2c8e6.
c2c4e7e6g1f3g8f6d2d4d7d5b1c3b8d7c4d5e6d5c1g5f8e7e2e3c7c6d1c2d7f8f1d3f8e6g5h4g7g6.
c2c4e7e6g1f3g8f6g2g3b7b6f1g2c8b7e1g1f8e7b2b3e8g8c1b2d7d5c4d5e6d5d1c2f8e8e2e3b8d7.
c2c4e7e6g1f3g8f6g2g3d7d5b2b3f8e7f1g2e8g8e1g1b7b6c1b2c8b7e2e3b8d7b1c3f6e4c3e2a7a5.
c2c4e7e6g1f3g8f6g2g3d7d5f1g2f8e7e1g1e8g8d2d4b8d7b1d2b7b6c4d5e6d5f3e5c8b7d2f3f6e4.
c2c4e7e6g2g3d7d5f1g2d5d4b2b4c7c5b4b5e6e5d2d3f8d6e2e4d8c7g1e2h7h5h2h4g8h6e1g1c8g4.
c2c4e7e6g2g3d7d5f1g2g8f6g1f3f8e7d2d4d5c4b1c3e8g8f3e5c7c5d4c5d8d1c3d1b8d7e5c4d7c5.
c2c4e7e6g2g3d7d5f1g2g8f6g1f3f8e7e1g1e8g8b2b3b7b6c1b2c8b7e2e3c7c5d1e2b8c6f1d1a8c8.
c2c4e7e6g2g3d7d5f1g2g8f6g1f3f8e7e1g1e8g8d2d4b8d7b1d2c7c6b2b3b7b6c1b2c8b7a1c1a7a5.
c2c4e7e6g2g3d7d5f1g2g8f6g1f3f8e7e1g1e8g8d2d4b8d7d1c2c7c6b2b3b7b5b1d2b5c4b3c4c8a6.
c2c4e7e6g2g3d7d5f1g2g8f6g1f3f8e7e1g1e8g8d2d4b8d7d1c2c7c6c1f4f6e4b1c3g7g5f4c1f7f5.
c2c4e7e6g2g3d7d5f1g2g8f6g1f3f8e7e1g1e8g8d2d4c7c6b2b3b7b6c1b2c8b7b1c3b8d7d1c2a8c8.
c2c4e7e6g2g3d7d5f1g2g8f6g1f3f8e7e1g1e8g8d2d4d5c4d1c2a7a6c2c4b7b5c4c2c8b7c1d2b7e4.
c2c4e7e6g2g3d7d5f1g2g8f6g1f3f8e7e1g1e8g8d2d4d5c4f3e5b8c6g2c6b7c6b1c3c6c5d4c5e7c5.
c2c4e7e6g2g3d7d5g1f3g8f6f1g2f8e7d2d4e8g8b1c3d5c4f3e5c7c5d4c5d8d1c3d1e7c5e5c4b8c6.
c2c4e7e6g2g3d7d5g1f3g8f6f1g2f8e7d2d4e8g8b1d2b7b6e1g1c8b7b2b3b8d7c1b2c7c5a1c1a8c8.
c2c4e7e6g2g3f7f5f1g2g8f6g1f3f8e7e1g1e8g8b2b3a7a5a2a3d7d5c1b2c7c6d2d3c8d7b1d2b8a6.
c2c4e7e6g2g3f7f5f1g2g8f6g1f3f8e7e1g1e8g8b2b3d7d5c1b2c8d7d2d3d7e8b1d2b8c6a2a3a7a5.
c2c4e7e6g2g3g8f6f1g2d7d5g1f3d5c4d1a4b8d7a4c4a7a6e1g1f8d6d2d4e8g8f1d1d8e7c4c2a8b8.
c2c4e7e6g2g3g8f6f1g2d7d5g1f3f8e7e1g1e8g8d2d4b8d7d1c2b7b6c4d5f6d5b1c3c8b7c3d5b7d5.
c2c4f7f5g1f3g8f6g2g3g7g6f1g2f8g7d2d4d7d6b1c3e7e6e1g1e8g8d1c2b8c6f1d1d8e7a1b1a7a5.
c2c4g7g6b1c3c7c5g2g3f8g7f1g2b8c6a2a3a7a6a1b1a8b8d1a4d7d6b2b4c8f5g2c6b7c6a4c6f5d7.
c2c4g7g6b1c3c7c5g2g3f8g7f1g2b8c6e2e3e7e6g1e2g8e7d2d4c5d4e2d4d7d5c4d5c6d4e3d4e7d5.
c2c4g7g6b1c3c7c5g2g3f8g7f1g2b8c6g1f3e7e6e1g1g8e7d2d3e8g8c1d2b7b6d1c1c8b7d2h6d7d6.
c2c4g7g6b1c3c7c5g2g3f8g7f1g2b8c6g1f3e7e6e1g1g8e7d2d3e8g8c1d2h7h6a2a3d7d5a1b1a7a5.
c2c4g7g6b1c3f8g7g1f3d7d6d2d4g8f6e2e4e8g8f1e2e7e5e1g1b8d7f1e1c7c6d4d5c6c5a2a3f6e8.
c2c4g7g6b1c3f8g7g2g3d7d6f1g2e7e5d2d3b8c6e2e4f7f5g1e2g8h6h2h4c8e6c3d5h6f7c1e3d8d7.
c2c4g7g6b1c3f8g7g2g3e7e5f1g2d7d6e2e3g8f6g1e2c7c6e3e4e8g8d2d3a7a6h2h3b7b5c1g5b8d7.
c2c4g7g6d2d4f8g7b1c3d7d6e2e4g8f6f2f3e8g8c1e3e7e5g1e2c7c6d4d5c6d5c4d5a7a6d1d2b8d7.
c2c4g7g6d2d4g8f6b1c3d7d5c1f4f8g7a1c1d5c4e2e4c7c5d4c5d8a5f1c4e8g8e4e5f6d7g1f3d7c5.
c2c4g7g6d2d4g8f6b1c3d7d5g1f3f8g7d1a4c8d7a4b3d5c4b3c4e8g8e2e4d7g4c1e3f6d7a1d1d7b6.
c2c4g7g6d2d4g8f6b1c3d7d5g1f3f8g7e2e3e8g8f1e2d5c4e2c4c7c5d4d5e7e6d5e6d8d1e1d1c8e6.
c2c4g7g6d2d4g8f6g1f3f8g7g2g3e8g8f1g2d7d6e1g1b8c6b1c3a7a6b2b3a8b8c1b2b7b5c4b5a6b5.
c2c4g7g6e2e4f8g7d2d4d7d6b1c3a7a6c1e3g8f6f2f3c7c6f1d3b7b5d1d2b5c4d3c4d6d5c4b3d5e4.
c2c4g7g6g1f3f8g7b1c3d7d6d2d4g8f6c1g5h7h6g5h4g6g5h4g3f6h5e2e3c7c5d4c5h5g3h2g3d6c5.
c2c4g7g6g1f3f8g7b1c3e7e5g2g3g8e7f1g2e8g8d2d4e5d4f3d4b8c6d4c6e7c6e1g1d7d6c1d2c8g4.
c2c4g7g6g1f3f8g7d2d4g8f6b1c3e8g8e2e4d7d6f1e2e7e5e1g1b8c6d4d5c6e7f3d2c7c5a1b1f6e8.
c2c4g7g6g2g3f8g7f1g2c7c5g1f3b8c6e1g1g8h6b1c3e8g8a2a3a8b8b2b4b7b6a1b1c8b7d2d3h6f5.
c2c4g7g6g2g3f8g7f1g2e7e5b1c3g8e7e2e4e8g8g1e2b8c6d2d3d7d6e1g1c8e6c3d5f7f5c1e3d8d7.
c2c4g8f6b1c3c7c5g1f3b8c6d2d4c5d4f3d4g7g6e2e4f8g7c1e3f6g4d1g4c6d4g4d1d4e6a1c1d7d6.
c2c4g8f6b1c3c7c5g1f3b8c6e2e3e7e6d2d4d7d5c4d5e6d5f1e2c5d4f3d4f8d6e1g1e8g8e2f3d6e5.
c2c4g8f6b1c3c7c5g1f3d7d5c4d5f6d5e2e3e7e6d2d4b8c6f1d3f8e7e1g1c5d4e3d4e8g8f1e1d8d6.
c2c4g8f6b1c3c7c5g1f3d7d5c4d5f6d5g2g3b8c6f1g2d5c7a2a3e7e5b2b4f7f6b4c5f8c5e1g1e8g8.
c2c4g8f6b1c3c7c5g1f3d7d5c4d5f6d5g2g3d5c3b2c3g7g6d1a4b8d7h2h4h7h6a1b1f8g7f1g2e8g8.
c2c4g8f6b1c3c7c5g1f3e7e6e2e3b8c6d2d4d7d5c4d5e6d5f1e2f8d6d4c5d6c5e1g1e8g8c1d2a7a6.
c2c4g8f6b1c3c7c5g1f3g7g6e2e4b8c6d2d4c5d4f3d4f8g7c1e3f6g4d1g4c6d4g4d1d4e6a1c1d7d6.
c2c4g8f6b1c3c7c5g2g3e7e6g1f3b7b6f1g2c8b7b2b3f8e7c1b2d7d6e1g1e8g8d2d4c5d4d1d4a7a6.
c2c4g8f6b1c3c7c6e2e4d7d5e4d5c6d5d2d4e7e6g1f3f8e7f1d3d5c4d3c4e8g8e1g1b8c6f1e1a7a6.
c2c4g8f6b1c3d7d5c4d5f6d5e2e4d5c3b2c3g7g6c1a3b8d7g1f3f8g7f1e2c7c5e1g1e8g8d2d4c5d4.
c2c4g8f6b1c3d7d5c4d5f6d5g1f3d5c3b2c3g7g6d2d4f8g7e2e3c7c5f1b5b8d7e1g1e8g8a2a4a7a6.
c2c4g8f6b1c3d7d5c4d5f6d5g2g3g7g6f1g2d5c3b2c3f8g7a1b1b8d7c3c4e8g8g1f3a8b8e1g1b7b6.
c2c4g8f6b1c3d7d5c4d5f6d5g2g3g7g6f1g2d5c3b2c3f8g7a1b1b8d7g1f3e8g8e1g1e7e5d2d4c7c6.
c2c4g8f6b1c3d7d5c4d5f6d5g2g3g7g6f1g2d5c3b2c3f8g7c1a3b8d7g1f3c7c5d1a4e8g8a1b1a7a6.
c2c4g8f6b1c3d7d5c4d5f6d5g2g3g7g6f1g2d5c3b2c3f8g7d1b3b8c6g1f3e8g8e1g1c6a5b3c2c7c5.
c2c4g8f6b1c3d7d5c4d5f6d5g2g3g7g6f1g2d5c3b2c3f8g7g1f3e8g8e1g1c7c5a1b1b8c6d1a4c6a5.
c2c4g8f6b1c3d7d5d2d4c7c6g1f3d5c4a2a4c8f5f3e5e7e6f2f3f8b4e2e4f5e4f3e4f6e4c1d2d8d4.
c2c4g8f6b1c3d7d5d2d4g7g6c4d5f6d5e2e4d5c3b2c3f8g7f1b5c7c6b5c4b8d7g1f3h7h6e1g1e8g8.
c2c4g8f6b1c3d7d5d2d4g7g6e2e3f8g7g1f3e8g8d1b3c7c6c1d2e7e6a1c1b8d7c4d5e6d5f1d3f8e8.
c2c4g8f6b1c3e7e5e2e3b8c6a2a3d7d5c4d5f6d5d1c2d5c3d2c3f8d6e3e4c8e6g1f3f7f6c1e3d8e7.
c2c4g8f6b1c3e7e5g1f3b8c6a2a3d7d6d2d4c8g4d4d5c6e7e2e4g7g6f1e2f8g7e1g1f6h5f3e1g4e2.
c2c4g8f6b1c3e7e5g1f3b8c6d2d3f8e7e2e3d7d5c4d5f6d5f1e2e8g8e1g1c8e6a2a3a7a5d1c2d8d7.
c2c4g8f6b1c3e7e5g1f3b8c6d2d4e5d4f3d4f8b4c1g5h7h6g5h4b4c3b2c3c6e5f2f4e5g6h4f6d8f6.
c2c4g8f6b1c3e7e5g1f3b8c6g2g3f8b4c3d5b4c5d2d3h7h6f1g2d7d6e1g1e8g8e2e3a7a5d5c3c5a7.
c2c4g8f6b1c3e7e5g1f3b8c6g2g3f8b4c3d5b4c5f1g2d7d6e1g1e8g8e2e3c8g4h2h3g4f3g2f3f6d5.
c2c4g8f6b1c3e7e5g1f3b8c6g2g3f8b4c3d5b4c5f1g2d7d6e1g1f6d5c4d5c6d4f3d4c5d4e2e3d4b6.
c2c4g8f6b1c3e7e5g1f3b8c6g2g3f8b4c3d5f6d5c4d5c6d4f3d4e5d4d1c2d8e7f1g2b4c5e1g1e8g8.
c2c4g8f6b1c3e7e5g1f3b8c6g2g3f8b4f1g2e8g8c3d5f6d5c4d5c6d4f3d4e5d4d1c2d7d6e1g1a7a5.
c2c4g8f6b1c3e7e5g1f3b8c6g2g3f8b4f1g2e8g8e1g1e5e4f3e1b4c3d2c3h7h6e1c2b7b6c2e3c8b7.
c2c4g8f6b1c3e7e5g1f3b8c6g2g3f8b4f1g2e8g8e1g1e5e4f3e1b4c3d2c3h7h6e1c2f8e8c2e3b7b6.
c2c4g8f6b1c3e7e5g1f3b8c6g2g3f8b4f1g2e8g8e1g1e5e4f3g5b4c3b2c3f8e8f2f3e4f3g5f3d8e7.
c2c4g8f6b1c3e7e5g1f3b8c6g2g3f8c5f1g2e8g8e1g1f8e8e2e3c5b4c3d5b4f8d2d4d7d6d1b3f6e4.
c2c4g8f6b1c3e7e5g2g3c7c6g1f3d7d6f1g2g7g6e1g1f8g7d2d4b8d7e2e4e8g8h2h3f6e8c1g5f7f6.
c2c4g8f6b1c3e7e5g2g3c7c6g1f3e5e4f3d4d7d5c4d5d8b6d4b3c6d5f1g2a7a5d2d3a5a4c1e3b6b4.
c2c4g8f6b1c3e7e5g2g3f8b4d1b3b8c6c3d5b4c5e2e3e8g8f1g2f6d5c4d5c6e7g1e2d7d6e1g1c7c6.
c2c4g8f6b1c3e7e6d2d4d7d5c1g5b8d7e2e3c7c6g1f3d8a5f3d2f8b4d1c2e8g8f1e2e6e5g5f6d7f6.
c2c4g8f6b1c3e7e6d2d4d7d5c1g5f8e7e2e3h7h6g5h4b7b6c4d5f6d5h4e7d8e7c3d5e6d5g1e2e8g8.
c2c4g8f6b1c3e7e6d2d4d7d5e2e3b8d7g1f3c7c6d1c2f8d6c1d2d5c4f1c4e6e5d4e5d7e5f3e5d6e5.
c2c4g8f6b1c3e7e6d2d4f8b4a2a3b4c3b2c3b7b6f2f3c8a6e2e4d7d5c4d5a6f1e1f1e6d5c1g5h7h6.
c2c4g8f6b1c3e7e6d2d4f8b4c1d2e8g8g1f3b7b6e2e3c8b7a2a3b4c3d2c3d7d5a1c1b8d7f1e2f6e4.
c2c4g8f6b1c3e7e6d2d4f8b4c1d2e8g8g1f3b7b6e2e3c8b7f1d3d7d6e1g1b8d7a2a3b4c3d2c3f6e4.
c2c4g8f6b1c3e7e6d2d4f8b4c1d2e8g8g1f3c7c5d4c5b4c5e2e3d7d5a1c1d8e7c4d5e6d5f1e2b8c6.
c2c4g8f6b1c3e7e6d2d4f8b4d1c2e8g8a2a3b4c3c2c3b7b6c1g5c8b7e2e3c7c5d4c5b6c5f2f3b8c6.
c2c4g8f6b1c3e7e6d2d4f8b4e2e3b7b6g1e2c8a6a2a3b4c3e2c3d7d5b2b3e8g8a3a4c7c5c1a3d5c4.
c2c4g8f6b1c3e7e6d2d4f8b4e2e3b7b6g1e2c8a6a2a3b4c3e2c3d7d5b2b3e8g8f1e2d5c4b3c4b8c6.
c2c4g8f6b1c3e7e6d2d4f8b4e2e3b7b6g1e2c8a6a2a3b4c3e2c3d7d5b2b3e8g8f1e2d5c4b3c4b8c6.
c2c4g8f6b1c3e7e6d2d4f8b4e2e3e8g8f1d3c7c5d4d5b7b5d5e6f7e6c4b5a7a6g1e2d7d5e1g1e6e5.
c2c4g8f6b1c3e7e6d2d4f8b4e2e3e8g8f1d3d7d5a2a3d5c4d3c4b4d6g1f3b8c6b2b4e6e5c1b2c8g4.
c2c4g8f6b1c3e7e6d2d4f8b4e2e3e8g8f1d3d7d5a2a3d5c4d3c4b4d6g1f3b8c6b2b4e6e5c1b2c8g4.
c2c4g8f6b1c3e7e6d2d4f8b4e2e3e8g8f1d3d7d5a2a3d5c4d3c4b4d6g1f3b8c6c3b5e6e5b5d6d8d6.
c2c4g8f6b1c3e7e6d2d4f8b4e2e3e8g8g1e2d7d5a2a3b4e7c4d5e6d5g2g3b8d7f1g2d7b6e1g1f8e8.
c2c4g8f6b1c3e7e6d2d4f8b4g1f3c7c5e2e3e8g8f1d3d7d5e1g1b8d7c4d5e6d5d1b3d7b6c3e2a7a5.
c2c4g8f6b1c3e7e6e2e4c7c5e4e5f6g8d2d4c5d4d1d4b8c6d4e4d7d6g1f3d6e5f3e5g8f6e5c6d8b6.
c2c4g8f6b1c3e7e6e2e4c7c5e4e5f6g8g1f3b8c6d2d4c5d4f3d4c6e5d4b5a7a6b5d6f8d6d1d6f7f6.
c2c4g8f6b1c3e7e6e2e4c7c5e4e5f6g8g1f3b8c6d2d4c5d4f3d4c6e5d4b5a7a6b5d6f8d6d1d6f7f6.
c2c4g8f6b1c3e7e6e2e4c7c5e4e5f6g8g1f3d7d6e5d6f8d6d2d4c5d4d1d4g8f6c3b5d6b4c1d2d8d4.
c2c4g8f6b1c3e7e6e2e4d7d5e4e5f6e4g1f3f8e7d1c2e4g5f3g5e7g5c4d5e6d5d2d4g5e7c1e3e8g8.
c2c4g8f6b1c3e7e6g1f3b7b6e2e4c8b7d1e2c7c5e4e5f6g8d2d4b7f3e2f3b8c6d4d5c6e5f3g3d7d6.
c2c4g8f6b1c3e7e6g1f3b7b6e2e4c8b7d1e2f8b4e4e5f6g8d2d4g8e7c1d2e8g8e1c1d7d5h2h4b4c3.
c2c4g8f6b1c3e7e6g1f3b7b6e2e4c8b7d1e2f8b4e4e5f6g8g2g3b8c6f1g2c6d4e2d3b7f3g2f3d4f3.
c2c4g8f6b1c3e7e6g1f3b7b6e2e4c8b7d2d3d7d6g2g3f8e7f1g2e8g8e1g1c7c5b2b3b8a6f1e1e6e5.
c2c4g8f6b1c3e7e6g1f3b7b6e2e4c8b7f1d3c7c5e1g1b8c6e4e5f6g4d3e4d8c8f1e1d7d6e5d6f8d6.
c2c4g8f6b1c3e7e6g1f3b7b6e2e4c8b7f1d3c7c5e4e5f6g4h2h3b7f3d1f3g4e5f3a8e5d3e1e2d3f4.
c2c4g8f6b1c3e7e6g1f3b7b6e2e4c8b7f1d3d7d6d3c2c7c5d2d4c5d4f3d4a7a6b2b3f8e7e1g1e8g8.
c2c4g8f6b1c3e7e6g1f3b7b6e2e4f8b4d1e2c8b7e4e5f6g8d2d4d7d6c1d2d6e5d4e5b8a6e1c1d8e7.
c2c4g8f6b1c3e7e6g1f3b7b6g2g3c8b7f1g2f8e7d2d4e8g8d1c2c7c5d4d5e6d5f3g5g7g6c2d1d7d6.
c2c4g8f6b1c3e7e6g1f3b7b6g2g3c8b7f1g2f8e7e1g1e8g8d2d4f6e4d1c2e4c3c2c3f7f5b2b3e7f6.
c2c4g8f6b1c3e7e6g1f3c7c5d2d4d7d5c4d5f6d5e2e4d5c3b2c3c5d4c3d4f8b4c1d2b4d2d1d2e8g8.
c2c4g8f6b1c3e7e6g1f3c7c5e2e3f8e7b2b3e8g8c1b2b7b6d2d4c5d4e3d4d7d5f1d3b8c6e1g1c8b7.
c2c4g8f6b1c3e7e6g1f3c7c5g2g3b7b6f1g2c8b7e1g1f8e7d2d4c5d4d1d4e8g8f1d1b8c6d4f4d8b8.
c2c4g8f6b1c3e7e6g1f3c7c5g2g3b7b6f1g2c8b7e1g1f8e7d2d4c5d4d1d4e8g8f1d1b8c6d4f4d8b8.
c2c4g8f6b1c3e7e6g1f3c7c5g2g3b8c6f1g2d7d5c4d5e6d5d2d4f8e7e1g1e8g8c1f4c8e6a1c1a8c8.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4b8d7c4d5e6d5c1g5f8e7e2e3e8g8f1d3c7c6d1c2f8e8e1g1d7f8.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4b8d7c4d5e6d5c1g5f8e7e2e3e8g8f1d3c7c6d1c2f8e8h2h3d7f8.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4c7c5c4d5f6d5e2e3f8e7f1d3c5d4e3d4b7b6c3d5d8d5e1g1b8d7.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4c7c5c4d5f6d5e2e4d5c3b2c3c5d4c3d4f8b4c1d2b4d2d1d2e8g8.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4c7c5c4d5f6d5g2g3c5d4c3d5d8d5d1d4d5b5e2e3b5b4c1d2b8c6.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4c7c6c1g5b8d7e2e3d8a5g5f6d7f6f1d3f8b4d1b3e8g8e1g1c6c5.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4c7c6e2e3b8d7f1d3d5c4d3c4b7b5c4d3c8b7e1g1b5b4c3e4f6e4.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4c7c6e2e3b8d7f1d3d5c4d3c4b7b5c4d3c8b7e1g1b5b4c3e4f8e7.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4c7c6e2e3b8d7f1d3d5c4d3c4b7b5c4d3c8b7e1g1b5b4c3e4f8e7.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4c7c6e2e3b8d7f1d3d5c4d3c4b7b5c4d3c8b7e1g1b5b4c3e4f8e7.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4c7c6e2e3b8d7f1d3d5c4d3c4b7b5c4d3c8b7e3e4b5b4c3a4c6c5.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4c7c6e2e3b8d7f1d3d5c4d3c4b7b5c4d3c8b7e3e4b5b4c3a4c6c5.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4c7c6e2e3b8d7f1d3d5c4d3c4b7b5c4d3c8b7e3e4b5b4c3a4c6c5.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4f8b4c4d5e6d5c1g5h7h6g5f6d8f6d1a4b8c6e2e3e8g8f1e2a7a6.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4f8e7c1f4e8g8e2e3c7c5d4c5e7c5d1c2b8c6a1d1d8a5a2a3c5e7.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4f8e7c1f4e8g8e2e3c7c5d4c5e7c5d1c2b8c6a1d1d8a5a2a3c5e7.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4f8e7c1f4e8g8e2e3c7c5d4c5e7c5d1c2b8c6a1d1d8a5a2a3f8e8.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4f8e7c1g5e8g8e2e3b8d7c4d5e6d5d1c2f8e8f1d3c7c6e1c1a7a5.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4f8e7c1g5e8g8e2e3h7h6g5h4b7b6a1c1c8b7c4d5e6d5f1d3b8d7.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4f8e7c1g5h7h6g5h4e8g8a1c1b7b6h4f6e7f6c4d5e6d5g2g3c7c6.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4f8e7c1g5h7h6g5h4e8g8e2e3b7b6a1c1c8b7f1d3d5c4d3c4b8d7.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4f8e7c1g5h7h6g5h4e8g8e2e3b7b6a1c1c8b7f1e2d5c4e2c4f6e4.
c2c4g8f6b1c3e7e6g1f3d7d5d2d4f8e7g2g3e8g8f1g2d5c4f3e5b8c6g2c6b7c6e5c6d8e8c6e7e8e7.
c2c4g8f6b1c3e7e6g1f3d7d5e2e3f8e7d2d4e8g8f1d3d5c4d3c4c7c5e1g1a7a6d4c5d8d1f1d1e7c5.
c2c4g8f6b1c3e7e6g1f3f8b4g2g3b7b6f1g2c8b7e1g1e8g8d1b3b4c3b3c3d7d6b2b3d8e7c1b2c7c5.
c2c4g8f6b1c3g7g6d2d4d7d6e2e4f8g7f2f3e7e5d4e5d6e5d1d8e8d8c1e3c8e6g1h3e6h3g2h3c7c6.
c2c4g8f6b1c3g7g6d2d4f8g7c1g5d7d6e2e3c7c5g1f3h7h6g5h4g6g5h4g3f6h5d4c5h5g3h2g3d6c5.
c2c4g8f6b1c3g7g6d2d4f8g7e2e4d7d6f1e2e8g8g1f3e7e5d4d5b8d7c1g5h7h6g5h4a7a6e1g1d8e8.
c2c4g8f6b1c3g7g6d2d4f8g7e2e4d7d6f2f3e7e5g1e2c7c6c1e3e8g8d1d2d8a5e1c1b7b5c4b5c6b5.
c2c4g8f6b1c3g7g6d2d4f8g7e2e4d7d6f2f3e8g8c1e3e7e5d4d5c7c5g2g4f6e8h2h4f7f5e4f5g6f5.
c2c4g8f6b1c3g7g6d2d4f8g7e2e4d7d6g1f3e8g8f1e2e7e5d4d5b8d7d1c2a7a5h2h3c7c6c1e3c6d5.
c2c4g8f6b1c3g7g6d2d4f8g7g2g3e8g8f1g2d7d6g1f3b8c6e1g1a7a6h2h3a8b8c1e3b7b5c4b5a6b5.
c2c4g8f6b1c3g7g6e2e4d7d6d2d4f8g7f2f4c7c5d4d5e8g8g1f3e7e6f1e2e6d5e4d5f8e8e1g1f6g4.
c2c4g8f6b1c3g7g6e2e4d7d6g2g3c7c5f1g2b8c6g1e2f8g7e1g1e8g8d2d3a7a6a1b1a8b8a2a3b7b5.
c2c4g8f6b1c3g7g6e2e4f8g7d2d4d7d6g1f3e8g8f1e2e7e5d4e5d6e5d1d8f8d8c1g5d8e8c3d5f6d5.
c2c4g8f6b1c3g7g6g1f3f8g7g2g3e8g8f1g2d7d6e1g1b8c6d2d3e7e5a1b1a7a5a2a3f8e8f3d2c6d4.
c2c4g8f6b1c3g7g6g2g3f8g7f1g2d7d6g1f3e8g8e1g1c7c5d2d4b8c6d4d5c6a5d1d3a7a6f3d2a8b8.
c2c4g8f6b1c3g7g6g2g3f8g7f1g2e8g8d2d4d7d6g1f3b8c6e1g1a7a6a2a3c8g4c1e3e7e5d4e5d6e5.
c2c4g8f6b1c3g7g6g2g3f8g7f1g2e8g8d2d4d7d6g1f3b8c6e1g1a7a6d4d5c6a5f3d2c7c5d1c2e7e5.
c2c4g8f6b1c3g7g6g2g3f8g7f1g2e8g8d2d4d7d6g1f3b8d7e1g1e7e5e2e4e5d4f3d4d7c5f2f3a7a5.
c2c4g8f6b1c3g7g6g2g3f8g7f1g2e8g8d2d4d7d6g1f3c7c6e1g1c8f5f3h4f5e6d4d5c6d5c4d5e6d7.
c2c4g8f6b1c3g7g6g2g3f8g7f1g2e8g8d2d4d7d6g1f3c8g4h2h3g4f3g2f3b8c6f3g2f6d7e2e3e7e5.
c2c4g8f6b1c3g7g6g2g3f8g7f1g2e8g8e2e4c7c5g1e2b8c6e1g1d7d6a2a3c8d7h2h3f6e8d2d3e8c7.
c2c4g8f6b1c3g7g6g2g3f8g7f1g2e8g8f2f4c7c5g1f3d7d5c4d5f6d5e1g1d5c7b2b3b8c6c1b2a8b8.
c2c4g8f6b1c3g7g6g2g3f8g7f1g2e8g8g1f3c7c5e1g1b8c6d2d4d7d6d4c5d6c5c1e3f6d7d1c1c6d4.
c2c4g8f6b1c3g7g6g2g3f8g7f1g2e8g8g1f3c7c5e1g1b8c6d2d4d7d6d4c5d6c5c1e3f6d7d1c1c6d4.
c2c4g8f6b1c3g7g6g2g3f8g7f1g2e8g8g1f3d7d6e1g1b8c6a1b1e7e5b2b4e5e4f3e1c8f5d2d3d6d5.
c2c4g8f6d2d4c7c6c1f4d8b6d1d2f6e4d2c2d7d5f2f3e7e5f4e5b6a5b1c3e4c3b2c3d5c4e2e4b7b5.
c2c4g8f6d2d4c7c6e2e3d7d5f1d3g7g6g1f3f8g7b1c3e8g8e1g1c8g4h2h3g4f3d1f3e7e6f1d1b8d7.
c2c4g8f6d2d4d7d6g1f3g7g6b1c3f8g7g2g3e8g8f1g2b8d7e1g1e7e5e2e4c7c6b2b3e5d4f3d4d7c5.
c2c4g8f6d2d4e7e6b1c3f8b4a2a3b4c3b2c3b8c6f2f3b7b6e2e4c8a6e4e5f6g8g1h3c6a5d1a4g8e7.
c2c4g8f6d2d4e7e6b1c3f8b4e2e3c7c5f1d3e8g8g1f3d7d5e1g1b7b6c4d5e6d5a2a3b4c3b2c3c8a6.
c2c4g8f6d2d4e7e6b1c3f8b4e2e3c7c5g1e2c5d4e3d4d7d5c4c5f6e4c1d2e4d2d1d2a7a5a2a3b4c3.
c2c4g8f6d2d4e7e6b1c3f8b4e2e3c7c5g1e2d7d5a2a3b4c3e2c3c5d4e3d4d5c4f1c4b8c6c1e3e8g8.
c2c4g8f6d2d4e7e6g1f3b7b6a2a3c8b7b1c3d7d5c4d5f6d5d1c2d5c3b2c3b8d7e2e4c7c5c1f4c5d4.
c2c4g8f6d2d4e7e6g1f3b7b6b1c3f8b4e2e3c7c5f1d3d7d5d4c5b6c5e1g1e8g8c3e2c8b7b2b3b8d7.
c2c4g8f6d2d4e7e6g1f3b7b6e2e3c8b7b1c3d7d5c4d5e6d5f1b5c7c6b5d3f8e7e1g1e8g8b2b3b8d7.
c2c4g8f6d2d4e7e6g1f3b7b6g2g3c8b7f1g2f8e7e1g1e8g8d1c2c7c5d4c5e7c5b1c3b8c6e2e4e6e5.
c2c4g8f6d2d4e7e6g1f3c7c5e2e3c5d4e3d4d7d5b1c3f8b4f1d3d5c4d3c4d8c7d1d3e8g8e1g1b7b6.
c2c4g8f6d2d4e7e6g1f3d7d5b1c3c7c5e2e3b8c6a2a3f8d6d4c5d6c5b2b4c5d6c1b2e8g8c4d5e6d5.
c2c4g8f6d2d4e7e6g1f3d7d5c1g5b8d7b1c3c7c6e2e3d8a5g5f6d7f6f1d3f8b4d1c2d5c4d3c4f6d5.
c2c4g8f6d2d4e7e6g2g3d7d5f1g2d5c4d1a4c8d7a4c4d7c6g1f3c6d5c4a4d8d7a4d1b8c6b1c3f8b4.
c2c4g8f6d2d4e7e6g2g3d7d5f1g2f8e7g1f3e8g8d1c2c7c5d4c5d8a5c2c3a5c5c4d5f6d5c3c5e7c5.
c2c4g8f6d2d4e7e6g2g3d7d5f1g2f8e7g1f3e8g8e1g1d5c4d1c2a7a6a2a4c8d7c2c4d7c6c1f4a6a5.
c2c4g8f6d2d4g7g6b1c3d7d5c1f4f8g7e2e3e8g8f4e5e7e6g1f3b8d7e5g3c7c6f1d3b7b6e1g1c8b7.
c2c4g8f6d2d4g7g6b1c3f8g7g2g3d7d5f1g2d5c4d1a4f6d7e2e3e8g8a4c4c7c5g1f3c5d4f3d4d7e5.
c2c4g8f6d2d4g7g6g2g3c7c6g1f3f8g7b1c3e8g8f1g2d7d5d1b3d5c4b3c4c8e6c4d3b8a6e1g1e6f5.
c2c4g8f6g1f3b7b6b1c3c8b7d2d4e7e6e2e3f8b4f1d3f6e4e1g1f7f5c3e2b4d6b2b3e8g8f3e5b8c6.
c2c4g8f6g1f3b7b6g2g3c7c5f1g2c8b7e1g1e7e6b1c3f8e7d2d4c5d4d1d4e8g8f1d1b8c6d4f4d8b8.
c2c4g8f6g1f3b7b6g2g3c8b7f1g2c7c5e1g1e7e6b1c3f8e7d2d4c5d4f3d4b7g2g1g2d8c8d1d3b8c6.
c2c4g8f6g1f3b7b6g2g3c8b7f1g2e7e6d2d4f8e7b1c3f6e4c1d2c7c5e1g1e8g8a1c1e7f6c3e4b7e4.
c2c4g8f6g1f3c7c5b1c3e7e6g2g3b7b6f1g2c8b7e1g1f8e7d2d4c5d4d1d4e8g8e2e4d8c8e4e5b8c6.
c2c4g8f6g1f3c7c5b1c3e7e6g2g3b7b6f1g2c8b7e1g1f8e7d2d4f6e4c3e4b7e4c1f4e8g8d1d2b8c6.
c2c4g8f6g1f3c7c5g2g3b7b6f1g2c8b7e1g1e7e6b2b3f8e7c1b2e8g8e2e3d7d5c4d5f6d5d2d4c5d4.
c2c4g8f6g1f3c7c5g2g3b8c6f1g2g7g6e1g1f8g7b1c3e8g8d2d4c5d4f3d4c6d4d1d4d7d6f1d1c8e6.
c2c4g8f6g1f3c7c5g2g3d7d5f1g2b8c6c4d5f6d5b1c3d5f6e1g1e7e6b2b3f8e7c1b2e8g8a1c1d8a5.
c2c4g8f6g1f3c7c6b1c3d7d5d2d4d5c4a2a4c8f5e2e3e7e6f1c4b8d7e1g1f8b4d1e2f5g6f1d1e8g8.
c2c4g8f6g1f3c7c6b1c3d7d5e2e3g7g6d2d4f8g7c4d5f6d5f1c4e8g8e1g1b7b6d1b3d5c3b2c3c8a6.
c2c4g8f6g1f3c7c6d2d4d7d5b1c3d5c4a2a4c8f5f3e5e7e6f2f3f8b4e5c4e8g8c1g5h7h6g5h4b8a6.
c2c4g8f6g1f3c7c6d2d4d7d5e2e3g7g6b1c3f8g7f1d3e8g8e1g1c8g4h2h3g4f3d1f3e7e6f1d1b8d7.
c2c4g8f6g1f3e7e6b1c3d7d5d2d4b8d7c4d5e6d5c1g5f8e7e2e3e8g8f1d3c7c6d1c2f8e8e1g1d7f8.
c2c4g8f6g1f3e7e6b1c3d7d5d2d4f8b4c4d5e6d5c1g5h7h6g5f6d8f6d1b3f6d6a2a3b4c3b3c3e8g8.
c2c4g8f6g1f3e7e6b1c3f8b4d1c2e8g8e2e3b7b6b2b3c8b7c1b2d7d5f1e2b8d7e1g1a7a6a1d1d8e7.
c2c4g8f6g1f3e7e6b1c3f8b4g2g4h7h6h1g1d7d6h2h4e6e5g4g5h6g5h4g5f6g4c3d5b4c5d2d4c5b6.
c2c4g8f6g1f3e7e6d2d4b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2d7d5f3e5e8g8e1g1c7c6d2c3f6d7.
c2c4g8f6g1f3e7e6d2d4b7b6g2g3c8b7f1g2f8e7b1c3f6e4c1d2d7d6d4d5e4d2f3d2e8g8e1g1g8h8.
c2c4g8f6g1f3e7e6d2d4f8b4c1d2b4d2d1d2d7d6b1c3d8e7g2g3e8g8f1g2f8d8e1g1b8d7a1d1d7f8.
c2c4g8f6g1f3e7e6d2d4f8b4c1d2d8e7g2g3b8c6b1c3b4c3d2c3f6e4a1c1e8g8f1g2d7d6d4d5c6d8.
c2c4g8f6g1f3e7e6g2g3b7b6f1g2c8b7e1g1f8e7d2d4e8g8b1c3f6e4d1c2e4c3b2c3b8c6f3e5c6a5.
c2c4g8f6g1f3e7e6g2g3d7d5f1g2f8e7e1g1e8g8b2b3a7a5d2d4a5a4b1a3c7c6c1b2b8d7e2e3d8a5.
c2c4g8f6g1f3e7e6g2g3d7d5f1g2f8e7e1g1e8g8d2d4c7c6b2b3b8d7c1b2b7b6d1c2c8b7b1c3a8c8.
c2c4g8f6g1f3g7g6b1c3d7d5c4d5f6d5e2e4d5c3d2c3d8d1e1d1c8g4f1e2b8d7c1e3e7e5f3d2.
c2c4g8f6g1f3g7g6g2g3f8g7f1g2e8g8d2d4d7d6b1c3b8d7e1g1e7e5e2e4c7c6h2h3d8b6d4d5c6d5.
c2c4g8f6g1f3g7g6g2g3f8g7f1g2e8g8e1g1d7d5c4d5f6d5d2d4c7c5d4c5b8a6f3g5d5b4b1c3h7h6.
c2c4g8f6g2g3c7c5f1g2d7d5c4d5f6d5b1c3d5c7d2d3e7e5c1e3b8c6g2c6b7c6d1a4c8d7a1c1a8b8.
c2c4g8f6g2g3c7c6g1f3d7d5b2b3c8f5c1a3g7g6d2d3f8g7b1d2d8b6f1g2f6g4d3d4b8a6e1g1a6b4.
c2c4g8f6g2g3c7c6g1f3d7d5b2b3c8f5f1g2e7e6c1b2b8d7e1g1h7h6d2d3f8e7b1d2e8g8a2a3a7a5.
c2c4g8f6g2g3c7c6g1f3d7d5b2b3c8f5f1g2e7e6e1g1b8d7c1b2f8e7b1c3e8g8f3h4f5g4h2h3g4h5.
c2c4g8f6g2g3c7c6g1f3d7d5b2b3g7g6c1b2f8g7f1g2d8b6d1c1e8g8e1g1b8d7c4d5c6d5b2d4b6d6.
c2c4g8f6g2g3e7e6f1g2d7d5d2d4d5c4d1a4b8d7g1f3a7a6a4c4b7b5c4c6a8b8c1f4f6d5f4g5f8e7.
c2c4g8f6g2g3e7e6f1g2d7d5g1f3d5c4d1a4b8d7a4c4a7a6e1g1b7b5c4c2c8b7b2b3c7c5c1b2f8e7.
c2c4g8f6g2g3e7e6f1g2d7d5g1f3d5c4e1g1a7a6d1c2b7b5f3e5f6d5d2d3c4d3e5d3c8b7f1d1d8c8.
c2c4g8f6g2g3e7e6f1g2d7d5g1f3d5d4b2b4c7c5c1b2d8b6d1b3b8c6b4b5c6a5b3c2f8d6e2e3e6e5.
c2c4g8f6g2g3e7e6f1g2d7d5g1f3f8e7d2d4e8g8b1d2b7b6e1g1c8b7c4d5e6d5f3e5b8d7d2f3c7c5.
c2c4g8f6g2g3g7g6f1g2f8g7b1c3c7c5d2d3b8c6c1d2d7d6d1c1c6d4a1b1a8b8d2h6d4c2e1f1g7h6.
c2c4g8f6g2g3g7g6f1g2f8g7d2d4e8g8b1c3c7c6d4d5d7d6g1f3e7e5e1g1c6d5c4d5b8d7a2a4a7a5.
c2c4g8f6g2g3g7g6f1g2f8g7e2e4d7d6g1e2e8g8e1g1c7c5b1c3b8c6d2d3c8d7h2h3f6e8g3g4e8c7.
c2c4g8f6g2g3g7g6f1g2f8g7g1f3d7d6b1c3e7e5d2d3e8g8c1d2b8d7e1g1f8e8a1b1d7f8b2b4c7c6.
d2d3g7g6c2c3g8f6g1f3f8g7g2g3e8g8f1g2c7c5e1g1b8c6.
d2d3g7g6c2c3g8f6g2g3f8g7f1g2e8g8g1f3c7c5e1g1b8c6.
d2d3g7g6e2e4d7d6g1f3f8g7f1e2g8f6e1g1e8g8b1c3c7c5.
d2d3g7g6g1f3g8f6g2g3f8g7f1g2e8g8e1g1c7c5c2c3b8c6.
d2d3g7g6g2g3g8f6f1g2f8g7c2c3e8g8g1f3c7c5e1g1b8c6.
d2d4b7b5e2e4c8b7f2f3a7a6c1e3e7e6b1d2g8f6c2c3f8e7f1d3d7d6a2a4c7c6g1e2b8d7e1g1e8g8.
d2d4c7c5d4d5e7e5e2e4d7d6f2f4e5f4c1f4d8h4g2g3h4e7b1c3g7g5f4e3b8d7g1f3h7h6d1d2g8f6.
d2d4c7c6e2e4d7d5e4d5c6d5c2c4g8f6b1c3b8c6c1g5d8a5d1d2c8e6c4c5f6e4c3e4d5e4d2a5c6a5.
d2d4d7d5c1f4g8f6e2e3c8f5f1d3f5g6h2h3e7e6g1f3b8d7e1g1f8e7d1e2c7c5c2c3e8g8b1d2a8c8.
d2d4d7d5c1g5f7f6g5h4b8c6e2e3g8h6f1d3h6f5g1f3h7h5h4g3c6b4e3e4d5e4d3e4g7g5c2c3b4d5.
d2d4d7d5c2c4b8c6c4d5d8d5e2e3e7e5b1c3f8b4c1d2b4c3d2c3e5d4g1e2g8f6e2d4e8g8d4b5d5g5.
d2d4d7d5c2c4b8c6c4d5d8d5g1f3g8f6b1c3d5a5e2e3e7e5d4e5c6e5f1b5e5d7d1b3f8b4c1d2e8g8.
d2d4d7d5c2c4b8c6g1f3c8g4d1a4g4f3g2f3g8f6b1c3e7e6c1g5d5c4e1c1f8e7a4c4f6d5g5e7c6e7.
d2d4d7d5c2c4c7c6b1c3d5c4e2e4e7e5f1c4e5d4g1f3b7b5c3b5c8a6d1b3d8e7e1g1a6b5c4b5g8f6.
d2d4d7d5c2c4c7c6b1c3e7e6e2e4d5e4c3e4f8b4c1d2d8d4d2b4d4e4f1e2c6c5b4c3f7f6g1f3e4f4.
d2d4d7d5c2c4c7c6b1c3e7e6g1f3g8f6c1g5d5c4e2e4b7b5e4e5h7h6g5h4g7g5f3g5h6g5h4g5b8d7.
d2d4d7d5c2c4c7c6b1c3e7e6g1f3g8f6e2e3b8d7d1c2f8d6f1e2e8g8b2b3d8e7e1g1d5c4b3c4e6e5.
d2d4d7d5c2c4c7c6b1c3g8f6c1g5b8d7g1f3e7e6c4d5e6d5e2e3f8d6f1d3h7h6g5h4e8g8d1c2f8e8.
d2d4d7d5c2c4c7c6b1c3g8f6c4d5c6d5c1f4e7e6e2e3f8e7f1d3b8c6h2h3e8g8g1f3c8d7e1g1d8b6.
d2d4d7d5c2c4c7c6b1c3g8f6c4d5c6d5g1f3b8c6c1f4e7e6e2e3f8e7h2h3e7d6f1d3d6f4e3f4e8g8.
d2d4d7d5c2c4c7c6b1c3g8f6e2e3a7a6f1d3b7b5b2b3c8g4g1e2b8d7e1g1e7e6f2f3g4h5e2f4f8d6.
d2d4d7d5c2c4c7c6b1c3g8f6e2e3c8f5c4d5c6d5d1b3f5c8g1f3b8c6f3e5e7e6f1b5d8c7c1d2f8d6.
d2d4d7d5c2c4c7c6b1c3g8f6e2e3e7e6f1d3b8d7f2f4d5c4d3c4b7b5c4d3c8b7g1f3a7a6a2a4b5b4.
d2d4d7d5c2c4c7c6b1c3g8f6e2e3e7e6g1f3b8d7d1c2f8d6f1d3e8g8e1g1d5c4d3c4a7a6f1d1b7b5.
d2d4d7d5c2c4c7c6b1c3g8f6e2e3e7e6g1f3b8d7f1d3d5c4d3c4b7b5c4d3a7a6e3e4c6c5d4d5c8b7.
d2d4d7d5c2c4c7c6b1c3g8f6e2e3e7e6g1f3b8d7f1d3d5c4d3c4b7b5c4d3a7a6e3e4c6c5e4e5c5d4.
d2d4d7d5c2c4c7c6b1c3g8f6e2e3e7e6g1f3b8d7f1d3d5c4d3c4b7b5c4d3c8b7a2a3b5b4c3e4f6e4.
d2d4d7d5c2c4c7c6b1c3g8f6e2e3e7e6g1f3b8d7f1d3d5c4d3c4b7b5c4d3c8b7e1g1a7a6e3e4c6c5.
d2d4d7d5c2c4c7c6b1c3g8f6e2e3e7e6g1f3b8d7f1d3d5c4d3c4b7b5c4e2b5b4c3a4c8b7e1g1f8e7.
d2d4d7d5c2c4c7c6b1c3g8f6e2e3e7e6g1f3f8e7f1d3b8d7e1g1e8g8b2b3f8e8c1b2d7f8f3e5f8g6.
d2d4d7d5c2c4c7c6b1c3g8f6e2e3g7g6g1f3f8g7f1d3e8g8e1g1c8g4h2h3g4f3d1f3e7e6f1d1b8d7.
d2d4d7d5c2c4c7c6b1c3g8f6e2e3g7g6g1f3f8g7f1d3e8g8e1g1c8g4h2h3g4f3d1f3f8e8f1d1d8d6.
d2d4d7d5c2c4c7c6b1c3g8f6g1f3d5c4a2a4c6c5e2e4c5d4d1d4d8d4f3d4e7e6d4b5b8a6f1c4f8c5.
d2d4d7d5c2c4c7c6b1c3g8f6g1f3d5c4a2a4c8f5e2e3e7e6f1c4f8b4e1g1b8d7d1e2f5g6e3e4e8g8.
d2d4d7d5c2c4c7c6b1c3g8f6g1f3d5c4a2a4c8f5e2e3e7e6f1c4f8b4e1g1b8d7d1e2f5g6f1d1d8c7.
d2d4d7d5c2c4c7c6b1c3g8f6g1f3d5c4a2a4c8f5e2e3e7e6f1c4f8b4e1g1e8g8d1e2f5g4h2h3g4f3.
d2d4d7d5c2c4c7c6b1c3g8f6g1f3e7e6c1g5b8d7e2e3d8a5c4d5f6d5d1d2f8b4a1c1e8g8f1d3h7h6.
d2d4d7d5c2c4c7c6b1c3g8f6g1f3e7e6c1g5d5c4a2a4f8b4e2e4c6c5f1c4c5d4f3d4h7h6g5e3f6e4.
d2d4d7d5c2c4c7c6b1c3g8f6g1f3e7e6c1g5d5c4e2e4b7b5e4e5h7h6g5h4g7g5f3g5h6g5h4g5b8d7.
d2d4d7d5c2c4c7c6b1c3g8f6g1f3e7e6c1g5h7h6g5f6d8f6e2e3b8d7f1d3d5c4d3c4g7g6e1g1f8g7.
d2d4d7d5c2c4c7c6b1c3g8f6g1f3e7e6c1g5h7h6g5f6d8f6e2e3b8d7f1d3f6d8e1g1f8e7a2a3e8g8.
d2d4d7d5c2c4c7c6b1c3g8f6g1f3e7e6c4d5e6d5c1g5h7h6g5h4f8e7d1c2e8g8e2e3f6e4h4e7d8e7.
d2d4d7d5c2c4c7c6b1c3g8f6g1f3e7e6e2e3a7a6f1d3b7b5b2b3b8d7e1g1c8b7c4c5f8e7a2a3a6a5.
d2d4d7d5c2c4c7c6b1c3g8f6g1f3e7e6e2e3b8d7f1d3d5c4d3c4b7b5c4d3a7a6e3e4c6c5e4e5c5d4.
d2d4d7d5c2c4c7c6b1c3g8f6g1f3e7e6e2e3f8e7f1d3e8g8e1g1b8d7b2b3b7b6c1b2c8b7f3e5d5c4.
d2d4d7d5c2c4c7c6b1c3g8f6g1f3g7g6c4d5c6d5c1f4f8g7e2e3e8g8f1e2b8c6h2h3f6e4a1c1c8e6.
d2d4d7d5c2c4c7c6c4d5c6d5b1c3g8f6c1f4b8c6g1f3a7a6f3e5e7e6e2e3f8d6f4g3d6e5d4e5f6d7.
d2d4d7d5c2c4c7c6c4d5c6d5b1c3g8f6c1f4d8b6d1c2b8c6e2e3c8f5c2d2e7e6f1b5f8b4b5c6b6c6.
d2d4d7d5c2c4c7c6c4d5c6d5b1c3g8f6g1f3b8c6c1f4c8f5e2e3e7e6d1b3f8b4f1b5d8a5b5c6b7c6.
d2d4d7d5c2c4c7c6c4d5c6d5b1c3g8f6g1f3b8c6c1f4c8f5e2e3e7e6f3e5c6e5f4e5f6d7e5g3a7a6.
d2d4d7d5c2c4c7c6e2e3c8f5a2a3e7e6c4c5a7a5d1b3d8c7b1c3b8d7c3a4g8f6g1e2f8e7e2g3f5g6.
d2d4d7d5c2c4c7c6e2e3c8f5b1c3e7e6g1f3b8d7a2a3f8d6c4c5d6c7b2b4e6e5f1e2g8f6c1b2e5e4.
d2d4d7d5c2c4c7c6e2e3g8f6b1c3e7e6g1f3b8d7f1d3d5c4d3c4b7b5c4d3a7a6e3e4c6c5e4e5c5d4.
d2d4d7d5c2c4c7c6e2e3g8f6g1f3c8f5c4d5c6d5b1c3e7e6f3e5f6d7g2g4f5g6e5g6h7g6f1g2b8c6.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3a7a6c1g5d5c4a2a4c8e6e2e4b8d7d4d5c6d5e4d5e6g4f1c4g4f3.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4b8a6e2e3c8g4f1c4e7e6h2h3g4h5e1g1a6b4c4e2f8e7.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5e2e3e7e6f1c4b8d7d1e2f6e4e1g1f8b4c4d3b4c3.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5e2e3e7e6f1c4b8d7e1g1f8d6d1e2f6e4c3e4f5e4.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5e2e3e7e6f1c4f8b4e1g1b8d7d1e2e8g8e3e4f5g6.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5e2e3e7e6f1c4f8b4e1g1b8d7d1e2e8g8e3e4f5g6.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5e2e3e7e6f1c4f8b4e1g1b8d7d1e2e8g8e3e4f5g6.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5e2e3e7e6f1c4f8b4e1g1b8d7d1e2f5g6c4d3g6d3.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5e2e3e7e6f1c4f8b4e1g1b8d7d1e2f5g6e3e4e8g8.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5e2e3e7e6f1c4f8b4e1g1b8d7d1e2f6e4c4d3b4c3.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5e2e3e7e6f1c4f8b4e1g1b8d7f3h4e8g8f2f3f5g6.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5e2e3e7e6f1c4f8b4e1g1e8g8c1d2b8d7f1e1h7h6.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5e2e3e7e6f1c4f8b4e1g1e8g8c3e2h7h6e2g3f5h7.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5e2e3e7e6f1c4f8b4e1g1e8g8d1e2b8d7f1d1d8c7.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5e2e3e7e6f1c4f8b4e1g1e8g8d1e2f5g4h2h3g4f3.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5e2e3e7e6f1c4f8b4e1g1e8g8d1e2f5g4h2h3g4f3.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5e2e3e7e6f1c4f8b4e1g1e8g8d1e2f6e4c4d3b4c3.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5f3e5b8a6f2f3f6d7e5c4e7e5e2e4e5d4c3e2f8b4.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5f3e5b8d7e5c4d8c7g2g3e7e5d4e5d7e5c1f4f6d7.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5f3e5b8d7e5c4d8c7g2g3e7e5d4e5d7e5c1f4f6d7.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5f3e5b8d7e5c4d8c7g2g3e7e5d4e5d7e5c1f4f6d7.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5f3e5b8d7e5c4d8c7g2g3e7e5d4e5d7e5c1f4f6d7.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5f3e5e7e6c1g5f8b4e5c4d8d5g5f6d5c4d1d2g7f6.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5f3e5e7e6c1g5f8b4f2f3h7h6g5f6g7f6e5c4c6c5.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5f3e5e7e6c1g5f8e7f2f3h7h6e2e4f5h7g5e3b8d7.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5f3e5e7e6f2f3c6c5d4c5d8d1e1d1f8c5e2e4f5g6.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5f3e5e7e6f2f3f8b4c1g5c6c5d4c5d8d5d1d5e6d5.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8f5f3h4f5c8e2e3e7e5d4e5d8d1c3d1f8b4c1d2b4d2.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4c8g4f3e5g4h5h2h3b8a6g2g4h5g6f1g2a6b4e1g1g6c2.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4e7e6e2e4f8b4e4e5f6d5c1d2b4c3b2c3b7b5f3g5f7f6.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4a2a4e7e6e2e4f8b4e4e5f6e4d1c2d8d5f1e2c6c5e1g1e4c3.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3d5c4e2e3b7b5a2a4b5b4c3b1c8a6f1e2e7e6f3e5f8e7e1g1e8g8.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6c1g5b8d7e2e3d8a5c4d5f6d5d1d2d7b6f1d3d5c3b2c3b6d5.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6c1g5b8d7e2e3d8a5c4d5f6d5d1d2d7b6f1d3f8b4a1c1f7f6.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6c1g5b8d7e2e3d8a5c4d5f6d5d1d2f8b4a1c1h7h6g5h4e8g8.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6c1g5b8d7e2e3d8a5f3d2f8b4d1c2d5c4g5f6d7f6d2c4a5c7.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6c1g5b8d7e2e3d8a5f3d2f8b4d1c2e8g8f1e2d5c4g5f6d7f6.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6c1g5h7h6g5f6d8f6e2e3b8d7f1d3d5c4d3c4g7g6e1g1f8g7.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6c1g5h7h6g5f6d8f6e2e3f8d6f1d3f6e7e1g1b8d7c4c5d6c7.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6c1g5h7h6g5h4d5c4e2e4g7g5h4g3b7b5f1e2b5b4c3a4f6e4.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6d1b3f8e7c1g5d5c4b3c4b7b6e2e4c8a6c4b3a6f1h1f1e8g8.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6e2e3a7a6c4c5b8d7b2b4a6a5b4b5e6e5d1a4d8c7c1a3e5e4.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6e2e3b8d7d1c2b7b6f1d3c8b7e1g1f8d6f1d1d8e7b2b3e8g8.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6e2e3b8d7d1c2b7b6f1d3c8b7e1g1f8e7b2b3d8c7c1b2a8d8.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6e2e3b8d7d1c2b7b6f1d3c8b7e1g1f8e7b2b3d8c7c1b2a8d8.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6e2e3b8d7d1c2f8d6f1d3e8g8e1g1d5c4d3c4b7b5c4d3c8b7.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6e2e3b8d7d1c2f8d6f1e2e8g8e1g1d5c4e2c4d8e7a2a3e6e5.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6e2e3b8d7d1c2f8d6f1e2e8g8e1g1d5c4e2c4d8e7h2h3a7a6.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6e2e3b8d7d1c2f8d6f1e2e8g8e1g1d5c4e2c4d8e7h2h3c6c5.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6e2e3b8d7d1c2f8d6f1e2e8g8e1g1d5c4e2c4d8e7h2h3c6c5.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6e2e3b8d7d1c2f8d6f1e2e8g8e1g1f8e8f1d1d8e7a2a3b7b6.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6e2e3b8d7f1d3d5c4d3c4b7b5c4d3b5b4c3e4f6e4d3e4c8b7.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6e2e3b8d7f1d3d5c4d3c4b7b5c4d3c8b7e1g1a7a6e3e4c6c5.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6e2e3b8d7f1d3d5c4d3c4b7b5c4d3c8b7e1g1a7a6e3e4c6c5.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6e2e3b8d7f1d3d5c4d3c4b7b5c4d3c8b7e1g1a7a6e3e4c6c5.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6e2e3b8d7f1d3f8b4e1g1e8g8a2a3b4c3b2c3d8c7f3d2e6e5.
d2d4d7d5c2c4c7c6g1f3g8f6b1c3e7e6e2e3b8d7f1e2f8d6e1g1e8g8d1c2d5c4e2c4a7a6f1d1d8e7.
d2d4d7d5c2c4c7c6g1f3g8f6c4d5c6d5b1c3b8c6c1f4c8f5e2e3e7e6d1b3f8b4f1b5d8a5e1g1e8g8.
d2d4d7d5c2c4c7c6g1f3g8f6c4d5c6d5b1c3b8c6c1f4e7e6e2e3f8d6f4d6d8d6f1e2e8g8e1g1c8d7.
d2d4d7d5c2c4c7c6g1f3g8f6d1c2d5c4c2c4c8f5g2g3e7e6f1g2b8d7e1g1f8e7e2e3e8g8c4e2c6c5.
d2d4d7d5c2c4c7c6g1f3g8f6e2e3c8f5b1c3e7e6f3h4f5g6d1b3d8b6h4g6h7g6c1d2b8d7f1d3f8e7.
d2d4d7d5c2c4c7c6g1f3g8f6e2e3c8f5c4d5c6d5b1c3e7e6d1b3d8c8c1d2b8c6a1c1f8e7f1b5e8g8.
d2d4d7d5c2c4c7c6g1f3g8f6e2e3c8f5c4d5c6d5b1c3e7e6f3e5f6d7d1b3d8c8c1d2b8c6a1c1f8e7.
d2d4d7d5c2c4c7c6g1f3g8f6e2e3c8f5c4d5f6d5f1c4e7e6e1g1b8d7d1e2f5g4h2h3g4h5e3e4d5b6.
d2d4d7d5c2c4c7c6g1f3g8f6e2e3c8f5f1d3f5d3d1d3e7e6e1g1b8d7b1d2f8e7b2b3e8g8c1b2a7a5.
d2d4d7d5c2c4c7c6g1f3g8f6e2e3e7e6b1c3a7a6c4c5b7b6c5b6b8d7c3a4d7b6c1d2b6a4d1a4d8b6.
d2d4d7d5c2c4c7c6g1f3g8f6e2e3e7e6b1c3a7a6c4c5b8d7b2b4a6a5b4b5f6e4c3e4d5e4f3d2f7f5.
d2d4d7d5c2c4c7c6g1f3g8f6e2e3e7e6f1d3b8d7b1d2f8e7e1g1e8g8b2b3a7a5a2a3c6c5c4d5e6d5.
d2d4d7d5c2c4c7c6g1f3g8f6e2e3e7e6f1d3b8d7b1d2f8e7e1g1e8g8b2b3b7b6c1b2c8b7d1e2a7a5.
d2d4d7d5c2c4c7c6g1f3g8f6e2e3e7e6f1d3b8d7b1d2f8e7e1g1e8g8e3e4d5e4d2e4b7b6d1e2c8b7.
d2d4d7d5c2c4c7c6g1f3g8f6e2e3e7e6f1d3b8d7e1g1d5c4d3c4f8d6b1d2e8g8c4b3d6c7d2c4b7b6.
d2d4d7d5c2c4c7c6g1f3g8f6e2e3e7e6f1d3c6c5e1g1b8c6b1c3f8e7a2a3a7a5d4c5e7c5d1e2e8g8.
d2d4d7d5c2c4c7c6g1f3g8f6e2e3g7g6b1c3f8g7f1d3e8g8d1c2b8a6a2a3d5c4d3c4b7b5c4d3b5b4.
d2d4d7d5c2c4d5c4e2e3e7e5d4e5d8d1e1d1b8c6f1c4c6e5c4b5c7c6b5e2c8e6b1c3e8c8d1c2g8f6.
d2d4d7d5c2c4d5c4e2e3e7e5f1c4e5d4e3d4g8f6g1f3f8e7e1g1e8g8h2h3b8c6b1c3c6a5c4d3c8e6.
d2d4d7d5c2c4d5c4e2e4b8c6c1e3g8f6b1c3e7e5d4d5c6a5g1f3a7a6f3e5b7b5f1e2f8b4d1d4e8g8.
d2d4d7d5c2c4d5c4e2e4b8c6c1e3g8f6b1c3e7e5d4d5c6e7f1c4e7g6c4b5f6d7d1d2a7a6b5d3f8d6.
d2d4d7d5c2c4d5c4e2e4b8c6c1e3g8f6b1c3e7e5d4d5c6e7f1c4e7g6c4b5f6d7g1e2f8d6d1d2a7a6.
d2d4d7d5c2c4d5c4e2e4b8c6g1f3c8g4d4d5c6e5c1f4e5g6f4g3e7e5f1c4f8d6c4b5g4d7b5d7d8d7.
d2d4d7d5c2c4d5c4e2e4c7c5d4d5g8f6b1c3e7e6f1c4e6d5c3d5f6d5c4d5f8e7d1h5e8g8g1f3b8d7.
d2d4d7d5c2c4d5c4e2e4e7e5g1f3e5d4f1c4f8b4b1d2b8c6e1g1d8f6e4e5f6g6f3h4g6g4d2f3c8e6.
d2d4d7d5c2c4d5c4e2e4e7e5g1f3f8b4b1c3e5d4f3d4g8e7f1c4b8c6c1e3e8g8a2a3b4c3b2c3c6a5.
d2d4d7d5c2c4d5c4e2e4e7e5g1f3f8b4c1d2b4d2d1d2e5d4d2d4g8f6d4d8e8d8b1c3c8e6f3e5b8c6.
d2d4d7d5c2c4d5c4e2e4g8f6e4e5f6d5f1c4b8c6b1c3d5b6c4b5c8d7g1f3e7e6e1g1.
d2d4d7d5c2c4d5c4e2e4g8f6e4e5f6d5f1c4d5b6c4b3b8c6c1e3c8f5b1c3e7e6g1e2f8e7a2a3e8g8.
d2d4d7d5c2c4d5c4e2e4g8f6e4e5f6d5f1c4d5b6c4b3b8c6g1f3c8g4b3f7e8f7f3g5f7e8d1g4d8d4.
d2d4d7d5c2c4d5c4e2e4g8f6e4e5f6d5f1c4d5b6c4b3c7c5d4c5d8d1e1d1b6d7e5e6f7e6b3e6b8a6.
d2d4d7d5c2c4d5c4g1f3a7a6e2e3c8g4f1c4e7e6b1d2b8d7e1g1g8f6h2h3g4h5b2b3c7c5c4e2c5d4.
d2d4d7d5c2c4d5c4g1f3a7a6e2e3c8g4f1c4e7e6d1b3g4f3g2f3b7b5c4e2b8d7a2a4b5b4b1d2g8f6.
d2d4d7d5c2c4d5c4g1f3a7a6e2e3c8g4f1c4e7e6d1b3g4f3g2f3b7b5c4e2b8d7a2a4b5b4f3f4g8f6.
d2d4d7d5c2c4d5c4g1f3a7a6e2e3c8g4f1c4e7e6h2h3g4h5b1c3g8f6e1g1b8c6a2a3f8d6c4e2e8g8.
d2d4d7d5c2c4d5c4g1f3a7a6e2e3g8f6f1c4e7e6d1e2c7c5d4c5f8c5e1g1b7b5c4d3b8c6b1c3c8b7.
d2d4d7d5c2c4d5c4g1f3a7a6e2e3g8f6f1c4e7e6e1g1c7c5d1e2b7b5c4b3c8b7a2a4b8d7e3e4c5d4.
d2d4d7d5c2c4d5c4g1f3a7a6e2e3g8f6f1c4e7e6e1g1c7c5d1e2b8c6b1c3b7b5c4b3f8e7d4c5e7c5.
d2d4d7d5c2c4d5c4g1f3a7a6e2e3g8f6f1c4e7e6e1g1c7c5d4c5d8d1f1d1f8c5a2a3b7b5c4e2c8b7.
d2d4d7d5c2c4d5c4g1f3b8d7d1a4c7c6a4c4g8f6g2g3g7g6b1c3f8g7f1g2e8g8e1g1d8a5e2e4a5h5.
d2d4d7d5c2c4d5c4g1f3c7c5d4d5e7e6b1c3e6d5d1d5d8d5c3d5f8d6e2e4g8e7f1c4e7d5c4d5b8a6.
d2d4d7d5c2c4d5c4g1f3c7c5d4d5e7e6b1c3e6d5d1d5d8d5c3d5f8d6f3d2g8e7d2c4e7d5c4d6e8e7.
d2d4d7d5c2c4d5c4g1f3c7c5e2e3c5d4f1c4d8c7d1b3e7e6f3d4a7a6b1c3g8f6c1d2c8d7a1c1b8c6.
d2d4d7d5c2c4d5c4g1f3c7c5e2e3g8f6f1c4e7e6d1e2a7a6d4c5f8c5e1g1b8c6e3e4d8c7e4e5f6g4.
d2d4d7d5c2c4d5c4g1f3e7e6e2e3a7a6f1c4g8f6b1c3c7c5c4d3b8c6e1g1c5d4e3d4f8e7a2a3e8g8.
d2d4d7d5c2c4d5c4g1f3e7e6e2e3c7c5f1c4g8f6e1g1b8c6d1e2c5d4f1d1f8e7e3d4e8g8b1c3c6a5.
d2d4d7d5c2c4d5c4g1f3e7e6e2e3g8f6f1c4a7a6e1g1c7c5d4c5d8d1f1d1f8c5b1d2e8g8a2a3b7b5.
d2d4d7d5c2c4d5c4g1f3g8f6b1c3a7a6e2e4b7b5e4e5f6d5f3g5e7e6d1f3d8d7c3d5e6d5a2a3b8c6.
d2d4d7d5c2c4d5c4g1f3g8f6b1c3c7c5d4d5c8f5d1a4b8d7a4c4e7e6e2e4e6d5e4d5f8d6c1g5e8g8.
d2d4d7d5c2c4d5c4g1f3g8f6d1a4b8c6b1c3c8g4f3e5g4d7a4c4e7e6c1g5f8e7g5f6e7f6e5d7d8d7.
d2d4d7d5c2c4d5c4g1f3g8f6d1a4b8c6b1c3f6d5e2e4d5b6a4d1c8g4d4d5c6e5c1f4e5g6f4e3e7e6.
d2d4d7d5c2c4d5c4g1f3g8f6d1a4c7c6a4c4c8f5b1c3e7e6c4b3d8b6b3b6a7b6f3h4b6b5h4f5e6f5.
d2d4d7d5c2c4d5c4g1f3g8f6d1a4c7c6a4c4c8g4b1d2g7g6g2g3f8g7f1g2e8g8e1g1b8a6b2b3c6c5.
d2d4d7d5c2c4d5c4g1f3g8f6e2e3c7c5f1c4e7e6e1g1a7a6a2a4b8c6d1e2c5d4f1d1f8e7e3d4e8g8.
d2d4d7d5c2c4d5c4g1f3g8f6e2e3c7c5f1c4e7e6e1g1a7a6c4b3b8c6d1e2c5d4f1d1f8e7e3d4c6a5.
d2d4d7d5c2c4d5c4g1f3g8f6e2e3c7c5f1c4e7e6e1g1a7a6c4d3c5d4e3d4f8e7b1c3e8g8c1g5b7b5.
d2d4d7d5c2c4d5c4g1f3g8f6e2e3c7c5f1c4e7e6e1g1a7a6d1e2b8c6f1d1b7b5c4b3c5c4b3c2c6b4.
d2d4d7d5c2c4d5c4g1f3g8f6e2e3c7c5f1c4e7e6e1g1b8c6b1c3f8e7d4c5d8d1f1d1e7c5a2a3e8e7.
d2d4d7d5c2c4d5c4g1f3g8f6e2e3c8g4f1c4e7e6b1c3b8d7e1g1f8d6h2h3g4h5e3e4e6e5c4e2e8g8.
d2d4d7d5c2c4d5c4g1f3g8f6e2e3e7e6f1c4c7c5e1g1a7a6a2a4b8c6d1e2c5d4f1d1f8e7e3d4e8g8.
d2d4d7d5c2c4d5c4g1f3g8f6e2e3e7e6f1c4c7c5e1g1a7a6a2a4b8c6d1e2c5d4f1d1f8e7e3d4e8g8.
d2d4d7d5c2c4d5c4g1f3g8f6e2e3e7e6f1c4c7c5e1g1a7a6a2a4b8c6d1e2f8e7d4c5e7c5e3e4f6g4.
d2d4d7d5c2c4d5c4g1f3g8f6e2e3e7e6f1c4c7c5e1g1a7a6a2a4b8c6d1e2f8e7d4c5e7c5e3e4f6g4.
d2d4d7d5c2c4d5c4g1f3g8f6e2e3e7e6f1c4c7c5e1g1a7a6d1e2b7b5c4b3c8b7b1c3b8d7f1d1f8e7.
d2d4d7d5c2c4d5c4g1f3g8f6e2e3e7e6f1c4c7c5e1g1a7a6d1e2b7b5c4b3c8b7f1d1b8d7a2a4f8e7.
d2d4d7d5c2c4d5c4g1f3g8f6e2e3e7e6f1c4c7c5e1g1a7a6d1e2b7b5c4b3c8b7f1d1b8d7b1c3f8e7.
d2d4d7d5c2c4d5c4g1f3g8f6e2e3e7e6f1c4c7c5e1g1a7a6d1e2b8d7b1c3b7b5c4b3c8b7f1d1b5b4.
d2d4d7d5c2c4d5c4g1f3g8f6e2e3e7e6f1c4c7c5e1g1a7a6d1e2c5d4e3d4f8e7b1c3b7b5c4b3c8b7.
d2d4d7d5c2c4d5c4g1f3g8f6e2e3e7e6f1c4c7c5e1g1a7a6d4c5d8c7d1e2f8c5e3e4b8c6b1c3f6g4.
d2d4d7d5c2c4d5c4g1f3g8f6e2e3e7e6f1c4c7c5e1g1a7a6d4c5d8d1f1d1f8c5b2b3b7b5c4e2c8b7.
d2d4d7d5c2c4d5c4g1f3g8f6e2e3e7e6f1c4c7c5e1g1a7a6d4c5d8d1f1d1f8c5b2b3b8d7c1b2b7b5.
d2d4d7d5c2c4d5c4g1f3g8f6e2e3e7e6f1c4c7c5e1g1a7a6d4c5d8d1f1d1f8c5b2b3b8d7c1b2b7b6.
d2d4d7d5c2c4d5c4g1f3g8f6e2e3e7e6f1c4f8b4b1c3e8g8e1g1b7b6f3e5c8b7d1b3b4c3b2c3b7d5.
d2d4d7d5c2c4e7e6b1c3c7c5c4d5e6d5g1f3b8c6c1g5f8e7g5e7g8e7d4c5d8a5e2e3a5c5f1d3c8g4.
d2d4d7d5c2c4e7e6b1c3c7c5c4d5e6d5g1f3b8c6c1g5f8e7g5e7g8e7e2e3c8g4d4c5d8a5d1a4a5a4.
d2d4d7d5c2c4e7e6b1c3c7c5c4d5e6d5g1f3b8c6g2g3c5c4f1g2f8b4e1g1g8e7a2a3b4a5e2e4e8g8.
d2d4d7d5c2c4e7e6b1c3c7c5c4d5e6d5g1f3b8c6g2g3c5c4f1g2f8b4e1g1g8e7e2e4d5e4c3e4e8g8.
d2d4d7d5c2c4e7e6b1c3c7c5c4d5e6d5g1f3b8c6g2g3g8f6f1g2c5d4f3d4f8c5d4c6b7c6e1g1e8g8.
d2d4d7d5c2c4e7e6b1c3c7c5c4d5e6d5g1f3b8c6g2g3g8f6f1g2f8e7e1g1c8e6d4c5e7c5c1g5d5d4.
d2d4d7d5c2c4e7e6b1c3c7c5c4d5e6d5g1f3b8c6g2g3g8f6f1g2f8e7e1g1e8g8c1g5c5c4f3e5c8e6.
d2d4d7d5c2c4e7e6b1c3c7c5c4d5e6d5g1f3b8c6g2g3g8f6f1g2f8e7e1g1e8g8c1g5c5d4f3d4h7h6.
d2d4d7d5c2c4e7e6b1c3c7c5c4d5e6d5g1f3b8c6g2g3g8f6f1g2f8e7e1g1e8g8c1g5c5d4f3d4h7h6.
d2d4d7d5c2c4e7e6b1c3c7c5c4d5e6d5g1f3b8c6g2g3g8f6f1g2f8e7e1g1e8g8c1g5c5d4f3d4h7h6.
d2d4d7d5c2c4e7e6b1c3c7c5c4d5e6d5g1f3b8c6g2g3g8f6f1g2f8e7e1g1e8g8c1g5c8e6d4c5e7c5.
d2d4d7d5c2c4e7e6b1c3c7c5c4d5e6d5g1f3b8c6g2g3g8f6f1g2f8e7e1g1e8g8d4c5e7c5c1g5d5d4.
d2d4d7d5c2c4e7e6b1c3c7c5c4d5e6d5g1f3c5d4d1d4g8f6e2e4b8c6f1b5d5e4b5c6b7c6d4d8e8d8.
d2d4d7d5c2c4e7e6b1c3c7c5c4d5e6d5g1f3c8e6e2e4d5e4c3e4b8c6c1e3c5d4f3d4d8a5e4c3e8c8.
d2d4d7d5c2c4e7e6b1c3c7c5e2e3g8f6g1f3b8c6a2a3c5d4e3d4f8e7f1d3d5c4d3c4e8g8e1g1a7a6.
d2d4d7d5c2c4e7e6b1c3c7c5e2e3g8f6g1f3b8c6c4d5e6d5f1e2f8d6d4c5d6c5e1g1e8g8a2a3a7a5.
d2d4d7d5c2c4e7e6b1c3c7c5g1f3b8c6e2e3g8f6a2a3f8d6d4c5d6c5b2b4c5d6c1b2e8g8a1c1a7a5.
d2d4d7d5c2c4e7e6b1c3c7c5g1f3g8f6c4d5e6d5c1g5c8e6e2e3b8c6f1e2f8e7d4c5e7c5e1g1e8g8.
d2d4d7d5c2c4e7e6b1c3c7c6e2e3f7f5f2f4g8f6g1f3f8e7f1e2e8g8e1g1f6e4d1c2b8d7b2b3e4c3.
d2d4d7d5c2c4e7e6b1c3c7c6e2e3f7f5g1f3g8f6f1e2f8d6e1g1f6e4f3e5e8g8f2f3e4c3b2c3b7b6.
d2d4d7d5c2c4e7e6b1c3c7c6e2e3g8f6d1c2b8d7g1f3f8d6f1d3e8g8e1g1d5c4d3c4e6e5c3e4f6e4.
d2d4d7d5c2c4e7e6b1c3c7c6e2e3g8f6f2f3f8b4g1h3b8d7h3f4e8g8f1e2d5c4e2c4e6e5f4e2e5d4.
d2d4d7d5c2c4e7e6b1c3c7c6e2e3g8f6g1f3b8d7d1c2f8d6b2b3e8g8f1e2d5c4b3c4e6e5e1g1f8e8.
d2d4d7d5c2c4e7e6b1c3c7c6e2e3g8f6g1f3b8d7d1c2f8d6f1d3e8g8e1g1a7a6b2b3e6e5c4d5c6d5.
d2d4d7d5c2c4e7e6b1c3c7c6e2e3g8f6g1f3b8d7d1c2f8d6f1d3e8g8e1g1d5c4d3c4b7b5c4e2c8b7.
d2d4d7d5c2c4e7e6b1c3c7c6e2e3g8f6g1f3b8d7f1d3d5c4d3c4b7b5c4d3a7a6e3e4c6c5d4d5c5c4.
d2d4d7d5c2c4e7e6b1c3c7c6e2e3g8f6g1f3f8d6f1d3b8d7e1g1e8g8e3e4d5e4c3e4f6e4d3e4h7h6.
d2d4d7d5c2c4e7e6b1c3c7c6e2e4d5e4c3e4f8b4c1d2b4d2d1d2g8f6e4f6d8f6g1f3e8g8f1e2c6c5.
d2d4d7d5c2c4e7e6b1c3c7c6e2e4d5e4c3e4f8b4c1d2d8d4d2b4d4e4f1e2b8a6b4c3g8e7c3g7h8g8.
d2d4d7d5c2c4e7e6b1c3c7c6g1f3g8f6c1g5b8d7c4d5e6d5e2e3f8d6f1d3d7f8f3e5d8b6e1g1d6e5.
d2d4d7d5c2c4e7e6b1c3f7f5c1f4g8f6e2e3f8e7d1c2c7c6f1d3e8g8g1f3f6e4f4b8a8b8e1g1e7d6.
d2d4d7d5c2c4e7e6b1c3f8b4c4d5e6d5c1f4g8f6a1c1c7c6e2e3e8g8f1d3f8e8g1f3b8d7e1g1d7f8.
d2d4d7d5c2c4e7e6b1c3f8e7c4d5e6d5c1f4c7c6d1c2g7g6e1c1g8f6f2f3b8a6e2e4a6b4c2b3c8e6.
d2d4d7d5c2c4e7e6b1c3f8e7c4d5e6d5c1f4c7c6d1c2g7g6e2e3c8f5c2d2b8d7f2f3d7b6e3e4f5e6.
d2d4d7d5c2c4e7e6b1c3f8e7c4d5e6d5c1f4c7c6e2e3c8f5g1e2b8d7e2g3f5g6f1e2g8f6h2h4h7h5.
d2d4d7d5c2c4e7e6b1c3f8e7c4d5e6d5c1f4c7c6e2e3c8f5g2g4f5e6f1d3b8d7h2h3h7h5g4h5d7f6.
d2d4d7d5c2c4e7e6b1c3f8e7c4d5e6d5c1f4c7c6e2e3c8f5g2g4f5e6h2h3e7d6g1e2g8e7d1b3e6c8.
d2d4d7d5c2c4e7e6b1c3f8e7c4d5e6d5c1f4c7c6e2e3c8f5g2g4f5e6h2h3g8f6f1d3c6c5g1f3b8c6.
d2d4d7d5c2c4e7e6b1c3f8e7c4d5e6d5c1f4c7c6e2e3c8f5g2g4f5e6h2h3g8f6g1f3b8d7f1d3d7b6.
d2d4d7d5c2c4e7e6b1c3f8e7c4d5e6d5c1f4c7c6e2e3c8f5g2g4f5e6h2h4b8d7h4h5g8h6f1e2d7b6.
d2d4d7d5c2c4e7e6b1c3f8e7c4d5e6d5c1f4g8f6d1c2e8g8e2e3c7c5d4c5e7c5g1f3b8c6f1e2d5d4.
d2d4d7d5c2c4e7e6b1c3f8e7c4d5e6d5c1f4g8f6e2e3e8g8f1d3c7c5g1f3b8c6e1g1c8g4d4c5e7c5.
d2d4d7d5c2c4e7e6b1c3f8e7c4d5e6d5c1f4g8f6e2e3e8g8g1f3c8f5h2h3c7c6g2g4f5g6f3e5f6d7.
d2d4d7d5c2c4e7e6b1c3f8e7g1f3g8f6c1f4e8g8e2e3c7c5d4c5e7c5d1c2b8c6a1d1d8a5a2a3c5e7.
d2d4d7d5c2c4e7e6b1c3f8e7g1f3g8f6c1g5e8g8e2e3b8d7a1c1a7a6c4c5c7c6f1d3b7b6c5b6c6c5.
d2d4d7d5c2c4e7e6b1c3f8e7g1f3g8f6c1g5e8g8e2e3h7h6g5h4b7b6f1e2c8b7h4f6e7f6c4d5e6d5.
d2d4d7d5c2c4e7e6b1c3f8e7g1f3g8f6c1g5e8g8e2e3h7h6g5h4b7b6h4f6e7f6c4d5e6d5d1d2c8e6.
d2d4d7d5c2c4e7e6b1c3f8e7g1f3g8f6c1g5h7h6g5f6e7f6e2e3e8g8a1c1c7c6f1d3b8d7e1g1d5c4.
d2d4d7d5c2c4e7e6b1c3f8e7g1f3g8f6c1g5h7h6g5f6e7f6e2e3e8g8a1c1c7c6f1d3b8d7e1g1d5c4.
d2d4d7d5c2c4e7e6b1c3f8e7g1f3g8f6c1g5h7h6g5f6e7f6e2e3e8g8a1c1c7c6f1d3b8d7e1g1d5c4.
d2d4d7d5c2c4e7e6b1c3f8e7g1f3g8f6c1g5h7h6g5f6e7f6e2e3e8g8d1c2b8a6a1d1c7c5d4c5d8a5.
d2d4d7d5c2c4e7e6b1c3f8e7g1f3g8f6c1g5h7h6g5f6e7f6e2e3e8g8d1d2d5c4f1c4b8d7e1g1c7c5.
d2d4d7d5c2c4e7e6b1c3f8e7g1f3g8f6c1g5h7h6g5h4b8d7e2e3e8g8a1c1c7c6f1d3d5c4d3c4b7b5.
d2d4d7d5c2c4e7e6b1c3f8e7g1f3g8f6c1g5h7h6g5h4e8g8e2e3b7b6f1e2c8b7h4f6e7f6c4d5e6d5.
d2d4d7d5c2c4e7e6b1c3f8e7g1f3g8f6e2e3e8g8a2a3b7b6c4d5e6d5f1d3c7c5f3e5c8b7c3e2b8c6.
d2d4d7d5c2c4e7e6b1c3g8f6c1f4c7c5e2e3c5d4e3d4d5c4f1c4b8c6g1f3f8e7e1g1e8g8f1e1c8d7.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5b8d7e2e3c7c6a2a3f8e7g1f3e8g8f1d3d5c4d3c4f6d5g5e7d8e7.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5b8d7e2e3c7c6a2a3f8e7g1f3e8g8f1d3d5c4d3c4f6d5g5e7d8e7.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5b8d7e2e3c7c6d1c2d8a5c4d5f6d5e3e4d5c3g5d2a5a4c2c3a7a5.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5b8d7e2e3c7c6f1d3d8a5g5h4d5c4d3c4b7b5c4b3c8b7g1f3c6c5.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5b8d7e2e3c7c6f1d3d8a5g5h4d5c4d3c4b7b5c4d3c8b7g1e2a7a6.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5b8d7e2e3c7c6g1f3d8a5f3d2f8b4d1c2d5c4g5f6d7f6d2c4a5c7.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5b8d7e2e3c7c6g1f3d8a5f3d2f8b4d1c2d5c4g5f6d7f6d2c4a5c7.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5b8d7e2e3f8e7g1f3e8g8a1c1a7a6a2a3b7b6c4d5e6d5f1d3c8b7.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5b8d7e2e3f8e7g1f3e8g8a1c1a7a6a2a3h7h6g5h4d5c4f1c4b7b5.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5b8d7e2e3f8e7g1f3e8g8a1c1a7a6a2a3h7h6g5h4d5c4f1c4c7c5.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5b8d7e2e3f8e7g1f3e8g8a1c1a7a6a2a3h7h6g5h4d5c4f1c4c7c5.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5b8d7e2e3f8e7g1f3e8g8a1c1a7a6a2a3h7h6g5h4d5c4f1c4c7c5.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5b8d7e2e3f8e7g1f3e8g8a1c1a7a6c4d5e6d5f1d3c7c6d1c2f8e8.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5b8d7e2e3f8e7g1f3e8g8a1c1a7a6c4d5e6d5f1d3c7c6d1c2h7h6.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5b8d7e2e3f8e7g1f3e8g8a1c1a7a6c4d5e6d5f1d3c7c6e1g1f6e8.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5c7c5c4d5e6d5g5f6g7f6e2e3c8e6d1b3d8d7f1b5b8c6e3e4e8c8.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5c7c5e2e3c5d4e3d4f8e7g1f3e8g8f1d3d5c4d3c4b8c6e1g1b7b6.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5c7c6e2e3b8d7c4d5e6d5f1d3f8e7g1f3e8g8d1c2f8e8e1g1d7f8.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7c4d5f6d5g5e7d8e7e2e4d5c3b2c3c7c5g1f3e8g8f1d3c5d4.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7e2e3b8d7g1f3e8g8a1c1h7h6g5h4c7c6f1d3d5c4d3c4b7b5.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7e2e3b8d7g1f3e8g8d1b3c7c6f1e2d5c4b3c4f6d5g5f4d5f4.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7e2e3e8g8a1c1h7h6g5h4b7b6c4d5f6d5c3d5e6d5h4e7d8e7.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7e2e3e8g8d1b3d5c4f1c4c7c5d4c5b8d7c5c6b7c6g1f3f6d5.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7e2e3e8g8d1b3d5c4f1c4c7c5d4c5b8d7g1f3d7c5b3c2a7a6.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7e2e3e8g8d1b3d5c4f1c4c7c5d4c5d8a5g1f3a5c5e1g1b8c6.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7e2e3e8g8d1b3d5c4f1c4c7c5d4c5d8a5g1f3a5c5e1g1b8c6.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7e2e3e8g8d1b3d5c4f1c4c7c5d4c5d8a5g1f3a5c5e1g1b8c6.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7e2e3e8g8d1b3d5c4f1c4c7c5d4c5f6d7g5e7d8e7g1f3d7c5.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7e2e3e8g8f1d3b8d7g1f3b7b6c4d5e6d5e1g1c8b7d1e2c7c5.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7e2e3e8g8g1f3b8d7d1c2c7c5a1d1d8a5f1d3h7h6g5h4c5d4.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7e2e3e8g8g1f3b8d7d1c2c7c6f1d3d5c4d3c4f6d5g5e7d8e7.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7e2e3e8g8g1f3h7h6g5h4b7b6c4d5f6d5h4e7d8e7a1c1d5f6.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7e2e3e8g8g1f3h7h6g5h4b7b6f1e2c8b7h4f6e7f6c4d5e6d5.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7e2e3e8g8g1f3h7h6g5h4b7b6f1e2c8b7h4f6e7f6c4d5e6d5.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7e2e3e8g8g1f3h7h6g5h4b7b6f1e2c8b7h4f6e7f6c4d5e6d5.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7e2e3f6e4g5e7d8e7c4d5e4c3b2c3e6d5d1b3c7c6c3c4e8g8.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7e2e3f6e4g5e7d8e7f1d3e4c3b2c3b8d7g1f3e6e5d4e5d5c4.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7e2e3f6e4g5e7d8e7f1d3e4c3b2c3b8d7g1f3e8g8e1g1f8d8.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7e2e3h7h6g5h4e8g8a1c1b7b6h4f6e7f6c4d5e6d5d1f3c8e6.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7g1f3b8d7e2e3e8g8c4c5f6e4c3e4d5e4g5e7d8e7f3d2d7f6.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7g1f3e8g8c4c5b7b6b2b4b6c5d4c5a7a5a2a3d5d4g5f6g7f6.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7g1f3e8g8e2e3b8d7a1c1c7c6f1d3d5c4d3c4f6d5g5e7d8e7.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7g1f3e8g8e2e3b8d7c4c5c7c6f1d3h7h6g5h4e6e5d4e5f6e4.
d2d4d7d5c2c4e7e6b1c3g8f6c1g5f8e7g1f3e8g8e2e3d5c4f1c4b8d7e1g1c7c5d1e2h7h6g5h4d7b6.
d2d4d7d5c2c4e7e6b1c3g8f6c4d5e6d5c1g5c7c6d1c2b8a6e2e3a6b4c2d2c8f5a1c1a7a5a2a3b4a6.
d2d4d7d5c2c4e7e6b1c3g8f6c4d5e6d5c1g5c7c6d1c2f8e7e2e3b8d7f1d3f6h5g5e7d8e7g1e2d7b6.
d2d4d7d5c2c4e7e6b1c3g8f6c4d5e6d5c1g5c7c6e2e3c8f5d1f3f5g6g5f6d8f6f3f6g7f6a1d1b8d7.
d2d4d7d5c2c4e7e6b1c3g8f6c4d5e6d5c1g5f8e7e2e3b8d7d1c2e8g8f1d3f8e8g1f3d7f8e1g1c7c6.
d2d4d7d5c2c4e7e6b1c3g8f6c4d5e6d5c1g5f8e7e2e3e8g8f1d3b8d7g1e2f8e8e1g1d7f8b2b4a7a6.
d2d4d7d5c2c4e7e6b1c3g8f6c4d5e6d5c1g5f8e7e2e3h7h6g5h4e8g8f1d3b7b6g1f3c8b7e1g1c7c5.
d2d4d7d5c2c4e7e6b1c3g8f6c4d5e6d5c1g5f8e7e2e3h7h6g5h4e8g8f1d3b7b6g1f3c8b7e1g1c7c5.
d2d4d7d5c2c4e7e6b1c3g8f6c4d5e6d5c1g5f8e7e2e3h7h6g5h4e8g8f1d3b7b6g1f3c8b7e1g1f6e4.
d2d4d7d5c2c4e7e6b1c3g8f6e2e3c7c5g1f3b8c6a2a3d5c4f1c4c5d4e3d4f8e7e1g1e8g8c1e3c8d7.
d2d4d7d5c2c4e7e6b1c3g8f6e2e3c7c5g1f3b8c6d4c5f8c5a2a3a7a5f1e2e8g8e1g1d5c4d1c2e6e5.
d2d4d7d5c2c4e7e6b1c3g8f6f2f3b8c6e2e3f8e7g1h3e8g8h3f2f8e8f1e2e7b4c1d2e6e5d4e5e8e5.
d2d4d7d5c2c4e7e6b1c3g8f6f2f3c7c5d4c5f8c5c4d5f6d5e2e4d5c3d1d8e8d8b2c3b8c6g1h3d8c7.
d2d4d7d5c2c4e7e6b1c3g8f6g1f3b8d7c1g5c7c6e2e3d8a5f3d2f8b4d1c2e8g8g5h4c6c5d2b3a5a4.
d2d4d7d5c2c4e7e6b1c3g8f6g1f3b8d7c1g5f8e7e2e3e8g8a1c1f8e8f1d3d5c4d3c4c7c5e1g1a7a6.
d2d4d7d5c2c4e7e6b1c3g8f6g1f3b8d7e2e3f8e7b2b3e8g8f1d3b7b6e1g1c8b7c1b2a7a6a1c1f6e4.
d2d4d7d5c2c4e7e6b1c3g8f6g1f3b8d7e2e3f8e7f1d3e8g8e1g1c7c5d1c2b7b6c4d5e6d5b2b3c8b7.
d2d4d7d5c2c4e7e6b1c3g8f6g1f3b8d7e2e3f8e7f1d3e8g8e1g1d5c4d3c4c7c5d1e2a7a6f1d1b7b5.
d2d4d7d5c2c4e7e6b1c3g8f6g1f3d5c4e2e3c7c5f1c4c5d4e3d4f8e7e1g1e8g8d1e2b8d7c4b3d7b6.
d2d4d7d5c2c4e7e6b1c3g8f6g1f3f8b4a2a3b4c3b2c3d5c4d1a4b8c6c1g5d8d5g5f6g7f6g2g3c8d7.
d2d4d7d5c2c4e7e6b1c3g8f6g1f3f8e7c1f4c7c5d4c5b8a6e2e3a6c5c4d5e6d5f1b5c8d7b5d7d8d7.
d2d4d7d5c2c4e7e6b1c3g8f6g1f3f8e7c1g5h7h6g5f6e7f6d1b3c7c6e1c1d5c4b3c4b7b5c4b3a7a5.
d2d4d7d5c2c4e7e6b1c3g8f6g1f3f8e7c4d5e6d5c1f4c7c6d1c2g7g6e2e3c8f5f1d3f5d3c2d3b8d7.
d2d4d7d5c2c4e7e6b1c3g8f6g1f3f8e7e2e3e8g8f1d3c7c5d4c5d5c4d3c4d8d1e1d1b8c6a2a3e7c5.
d2d4d7d5c2c4e7e6b1c3g8f6g1f3f8e7e2e3e8g8f1d3c7c5d4c5d5c4d3c4d8d1e1d1b8c6a2a3e7c5.
d2d4d7d5c2c4e7e6b1c3g8f6g1f3f8e7e2e3e8g8f1d3c7c5e1g1c5d4e3d4d5c4d3c4b8d7c4b3d7b6.
d2d4d7d5c2c4e7e6g1f3b8d7b1c3g8f6c1g5f8e7e2e3e8g8a1c1c7c6d1c2a7a6a2a3h7h6g5h4f8e8.
d2d4d7d5c2c4e7e6g1f3c7c5c4d5e6d5g2g3b8c6f1g2g8f6e1g1f8e7b1c3e8g8c1e3c8e6d4c5f6g4.
d2d4d7d5c2c4e7e6g1f3c7c5c4d5e6d5g2g3b8c6f1g2g8f6e1g1f8e7c1e3c5c4f3e5e8g8b2b3c4b3.
d2d4d7d5c2c4e7e6g1f3c7c5c4d5e6d5g2g3g8f6f1g2f8e7e1g1e8g8b1c3b8c6c1g5c5d4f3d4h7h6.
d2d4d7d5c2c4e7e6g1f3c7c5c4d5e6d5g2g3g8f6f1g2f8e7e1g1e8g8b1c3b8c6c1g5c5d4f3d4h7h6.
d2d4d7d5c2c4e7e6g1f3c7c5c4d5e6d5g2g3g8f6f1g2f8e7e1g1e8g8b1c3b8c6c1g5c5d4f3d4h7h6.
d2d4d7d5c2c4e7e6g1f3c7c6b1c3d5c4a2a4f8b4e2e3b7b5c1d2a7a5a4b5b4c3d2c3c6b5b2b3c8b7.
d2d4d7d5c2c4e7e6g1f3c7c6b1d2f7f5g2g3f8d6f1g2b8d7e1g1d8f6c4d5e6d5d2b3g8e7c1f4e8g8.
d2d4d7d5c2c4e7e6g1f3c7c6d1c2g8f6e2e3f6e4b1c3f7f5f3e5b8d7e5d3f8d6d3f4d7f6f2f3e4c3.
d2d4d7d5c2c4e7e6g1f3c7c6d1c2g8f6g2g3g7g6f1g2f8g7e1g1e8g8f1d1b8d7b1d2f8e8b2b3b7b6.
d2d4d7d5c2c4e7e6g1f3c7c6e2e3f7f5f1d3g8f6e1g1f8d6b2b3d8e7c1b2e8g8f3e5b7b6c4d5c6d5.
d2d4d7d5c2c4e7e6g1f3c7c6g2g3f7f5f1g2g8f6e1g1f8e7b2b3e8g8c1a3b7b6a3e7d8e7f3e5c8b7.
d2d4d7d5c2c4e7e6g1f3g8f6b1c3b8d7c1g5f8e7e2e3e8g8a1c1b7b6c4d5e6d5d1a4c7c5f1a6h7h6.
d2d4d7d5c2c4e7e6g1f3g8f6b1c3b8d7c4d5e6d5c1g5f8e7e2e3c7c6d1c2d7f8f1d3f8e6h2h4h7h6.
d2d4d7d5c2c4e7e6g1f3g8f6b1c3c7c5c1g5c5d4f3d4d5c4e2e3d8b6g5f6g7f6f1c4c8d7e1g1b8c6.
d2d4d7d5c2c4e7e6g1f3g8f6b1c3c7c6e2e3b8d7f1d3f8b4a2a3b4a5d1c2d8e7c1d2d5c4d3c4e6e5.
d2d4d7d5c2c4e7e6g1f3g8f6b1c3c7c6e2e3b8d7f1d3f8b4a2a3b4a5d1c2d8e7c1d2d5c4d3c4e6e5.
d2d4d7d5c2c4e7e6g1f3g8f6b1c3c7c6e2e3b8d7f1d3f8b4e1g1e8g8c1d2d8e7d1b3d5c4b3c4b4d6.
d2d4d7d5c2c4e7e6g1f3g8f6b1c3f8b4c1g5b8d7c4d5e6d5a1c1c7c6e2e3d8a5d1b3f6e4f1d3e4g5.
d2d4d7d5c2c4e7e6g1f3g8f6b1c3f8b4c1g5b8d7c4d5e6d5d1c2e8g8a2a3b4c3b2c3c7c5e2e3d8a5.
d2d4d7d5c2c4e7e6g1f3g8f6b1c3f8b4c1g5b8d7c4d5e6d5d1c2e8g8a2a3b4e7e2e3c7c5d4c5d7c5.
d2d4d7d5c2c4e7e6g1f3g8f6b1c3f8b4c1g5b8d7c4d5e6d5d1c2e8g8a2a3b4e7e2e3c7c5f1e2b7b6.
d2d4d7d5c2c4e7e6g1f3g8f6b1c3f8e7c1g5e8g8e2e3h7h6g5h4f6e4h4e7d8e7d1c2e4c3c2c3d5c4.
d2d4d7d5c2c4e7e6g1f3g8f6b1c3f8e7c1g5h7h6g5f6e7f6e2e3e8g8a1c1a7a6c4d5e6d5f1d3c7c6.
d2d4d7d5c2c4e7e6g1f3g8f6b1c3f8e7c1g5h7h6g5f6e7f6e2e3e8g8d1d2b8c6a1c1a7a6f1e2d5c4.
d2d4d7d5c2c4e7e6g1f3g8f6b1c3f8e7c1g5h7h6g5h4e8g8e2e3b7b6a1c1c8b7f1e2d5c4e2c4b8d7.
d2d4d7d5c2c4e7e6g1f3g8f6c1g5d5c4d1a4b8d7b1d2c7c5d2c4a7a6g5f6g7f6d4c5f8c5a4d1b7b5.
d2d4d7d5c2c4e7e6g1f3g8f6c1g5f8e7b1c3e8g8e2e3h7h6g5f4c7c5d4c5e7c5c4d5f6d5c3d5e6d5.
d2d4d7d5c2c4e7e6g1f3g8f6c1g5f8e7b1c3h7h6g5h4e8g8e2e3b7b6d1b3c8b7h4f6e7f6c4d5e6d5.
d2d4d7d5c2c4e7e6g1f3g8f6c4d5e6d5b1c3c7c6c1g5h7h6g5h4c8f5d1b3g7g5h4g3d8b6e2e3b8a6.
d2d4d7d5c2c4e7e6g1f3g8f6c4d5e6d5c1g5c7c6b1c3h7h6g5h4c8f5d1b3g7g5h4g3d8b6e2e3f6e4.
d2d4d7d5c2c4e7e6g1f3g8f6g2g3d5c4f1g2c7c5d1a4c8d7a4c4d7c6d4c5b8d7c1e3c6d5c4a4d5c6.
d2d4d7d5c2c4e7e6g1f3g8f6g2g3f8e7f1g2c7c6d1c2e8g8e1g1b7b6b1d2c8b7e2e4d5e4d2e4b8d7.
d2d4d7d5c2c4e7e6g1f3g8f6g2g3f8e7f1g2e8g8e1g1d5c4d1c2a7a6c2c4b7b5c4c2c8b7c1d2b7e4.
d2d4d7d5c2c4e7e6g2g3g8f6f1g2f8e7g1f3b8d7e1g1e8g8d1c2c7c6f1d1b7b6b2b3c8b7b1c3a8c8.
d2d4d7d5c2c4e7e6g2g3g8f6f1g2f8e7g1f3e8g8e1g1d5c4b1d2c7c5d4c5b8c6d1c2e7c5d2c4d8e7.
d2d4d7d5c2c4g8f6b1c3e7e6e2e3b8d7g1f3f8b4f1d3d5c4d3c4f6e4d1c2e4c3b2c3b4d6e1g1e8g8.
d2d4d7d5c2c4g8f6c4d5f6d5e2e4d5f6b1c3e7e5d4e5d8d1e1d1f6g4c3d5e8d7g1h3c7c6d5c3g4e5.
d2d4d7d5e2e3e7e6f1d3c7c5b2b3b8c6g1f3g8f6e1g1c8d7c1b2a8c8c2c3f8d6b1d2e6e5d4e5c6e5.
d2d4d7d5e2e3g8f6c2c4e7e6b1c3f8e7g1f3e8g8f1e2d5c4e2c4c7c5e1g1b8c6d4c5e7c5d1d8f8d8.
d2d4d7d5g1f3b8c6c1f4c8f5e2e3e7e6f1d3g8e7e1g1f5d3d1d3e7g6f4g3f8d6g3d6c7d6b1d2e8g8.
d2d4d7d5g1f3b8c6c2c4c8g4c4d5g4f3g2f3d8d5e2e3e7e5b1c3f8b4c1d2b4c3b2c3d5d6a1b1b7b6.
d2d4d7d5g1f3c7c5c2c4c5d4c4d5g8f6d1a4d8d7a4d4d7d5b1c3d5d4f3d4c8d7d4b5e8d8c1e3b8c6.
d2d4d7d5g1f3c7c5c2c4d5c4d4d5e7e6b1c3e6d5d1d5d8d5c3d5f8d6f3d2g8e7d2c4e7d5c4d6e8e7.
d2d4d7d5g1f3c7c5c2c4d5c4e2e3e7e6f1c4g8f6e1g1a7a6c4b3b8c6d1e2f8e7f1d1c5d4e3d4c6a5.
d2d4d7d5g1f3c7c5c2c4e7e6c4d5e6d5b1c3b8c6g2g3g8f6f1g2f8e7e1g1e8g8c1g5c8e6d4c5e7c5.
d2d4d7d5g1f3c7c5c2c4e7e6c4d5e6d5g2g3g8f6f1g2f8e7e1g1e8g8b1c3b8c6c1g5c5d4f3d4h7h6.
d2d4d7d5g1f3c7c5c2c4e7e6c4d5e6d5g2g3g8f6f1g2f8e7e1g1e8g8b1c3b8c6c1g5c5d4f3d4h7h6.
d2d4d7d5g1f3c7c5c2c4e7e6c4d5e6d5g2g3g8f6f1g2f8e7e1g1e8g8b1c3b8c6c1g5c5d4f3d4h7h6.
d2d4d7d5g1f3c7c5c2c4e7e6c4d5e6d5g2g3g8f6f1g2f8e7e1g1e8g8b1c3b8c6c1g5c5d4f3d4h7h6.
d2d4d7d5g1f3c7c5d4c5e7e6e2e4f8c5e4d5e6d5f1b5b8c6e1g1g8f6b1c3e8g8c1g5c5e7g5f6e7f6.
d2d4d7d5g1f3c7c6c1g5h7h6g5h4d8b6b2b3b8d7e2e3e7e5f1e2e5e4f3d2c6c5d4c5d7c5b1c3g7g5.
d2d4d7d5g1f3c7c6c2c4d5c4e2e3c8g4f1c4e7e6b1c3b8d7h2h3g4h5a2a3g8f6e3e4f8e7e1g1e8g8.
d2d4d7d5g1f3c7c6c2c4e7e6e2e3f7f5f1e2g8f6e1g1f8d6b2b3d8e7c1b2b8d7f3e5e8g8b1d2g7g5.
d2d4d7d5g1f3c7c6c2c4e7e6e2e3g8f6f1d3c6c5e1g1d5c4d3c4a7a6f3e5d8c7b1d2b7b5c4e2c5d4.
d2d4d7d5g1f3c7c6c2c4g8f6b1c3e7e6e2e3b8d7d1c2f8d6f1d3e8g8e1g1d5c4d3c4a7a6f1d1b7b5.
d2d4d7d5g1f3c7c6c2c4g8f6b1c3e7e6e2e3b8d7d1c2f8d6f1d3e8g8e1g1d5c4d3c4a7a6f1d1b7b5.
d2d4d7d5g1f3c8f5c2c4e7e6c4d5e6d5d1b3b8c6c1g5f8e7g5e7g8e7e2e3d8d6b1d2e8g8a1c1a7a5.
d2d4d7d5g1f3c8f5c2c4e7e6d1b3b8c6c1d2d5c4b3b7g8e7b7b5a8b8b5a4b8b2b1a3d8d7a3c4b2b8.
d2d4d7d5g1f3e7e6c2c4a7a6c4c5b7b6c5b6c7c5b1c3b8d7c3a4c5c4c1d2f8d6b2b3c8b7e2e3c4b3.
d2d4d7d5g1f3e7e6c2c4c7c5c4d5e6d5b1c3b8c6g2g3g8f6f1g2c8e6e1g1f8e7d4c5e7c5c1g5d5d4.
d2d4d7d5g1f3e7e6c2c4d5c4e2e3c7c5f1c4g8f6e1g1a7a6e3e4b7b5c4d3c5d4a2a4b5a4e4e5f6d5.
d2d4d7d5g1f3e7e6c2c4f8e7b1c3g8f6c1g5h7h6g5h4e8g8e2e3b7b6f1d3c8b7e1g1b8d7a1c1c7c5.
d2d4d7d5g1f3e7e6c2c4g8f6c1g5b8d7e2e3f8e7b1c3e8g8a1c1f8e8d1c2c7c6f1d3d5c4d3c4f6d5.
d2d4d7d5g1f3e7e6c2c4g8f6c1g5f8e7e2e3b8d7b1c3e8g8a1c1b7b6c4d5e6d5f1b5c8b7d1a4a7a6.
d2d4d7d5g1f3e7e6c2c4g8f6c1g5f8e7e2e3b8d7b1c3e8g8a1c1c7c6d1c2c6c5c1d1d8a5c4d5f6d5.
d2d4d7d5g1f3e7e6g2g3c7c5f1g2c5d4e1g1g8f6f3d4e6e5d4f3b8c6c2c4d5d4e2e3f8c5e3d4c5d4.
d2d4d7d5g1f3e7e6g2g3c7c5f1g2c5d4e1g1g8f6f3d4e6e5d4f3b8c6c2c4d5d4e2e3f8c5e3d4c5d4.
d2d4d7d5g1f3e7e6g2g3c7c5f1g2g8f6e1g1c5d4f3d4e6e5d4f3b8c6c2c4d5d4e2e3d4d3b1c3f8b4.
d2d4d7d5g1f3g8f6c1f4e7e6e2e3f8e7f1d3c7c5c2c3b8c6b1d2a7a6h2h3b7b6f3e5c8b7d1e2f6d7.
d2d4d7d5g1f3g8f6c2c4c7c6b1c3d5c4a2a4c8f5e2e3e7e6f1c4f8b4e1g1b8d7d1e2e8g8e3e4f5g6.
d2d4d7d5g1f3g8f6c2c4c7c6b1c3e7e6c1g5b8d7e2e3d8a5c4d5f6d5d1d2f8b4a1c1e6e5a2a3b4d6.
d2d4d7d5g1f3g8f6c2c4c7c6b1c3e7e6c1g5b8d7e2e3d8a5c4d5f6d5d1d2f8b4a1c1e8g8f1d3e6e5.
d2d4d7d5g1f3g8f6c2c4c7c6b1c3e7e6c1g5b8d7e2e3d8a5f3d2f8b4d1c2e8g8a2a3d5c4g5f6d7f6.
d2d4d7d5g1f3g8f6c2c4c7c6b1c3e7e6c1g5b8d7e2e3d8a5f3d2f8b4d1c2e8g8f1e2e6e5g5f6d7f6.
d2d4d7d5g1f3g8f6c2c4c7c6b1c3e7e6c1g5d5c4e2e4b7b5e4e5h7h6g5h4g7g5f3g5h6g5h4g5f8e7.
d2d4d7d5g1f3g8f6c2c4c7c6b1c3e7e6c1g5h7h6g5f6d8f6e2e3b8d7f1d3d5c4d3c4f8d6e1g1f6e7.
d2d4d7d5g1f3g8f6c2c4c7c6b1c3e7e6d1b3b8d7c1g5d8a5g5d2a5b6e2e3d5c4b3c2f8d6f1c4e6e5.
d2d4d7d5g1f3g8f6c2c4c7c6b1c3e7e6e2e3b8d7d1c2f8d6f1d3e8g8e1g1d5c4d3c4a7a6f1d1b7b5.
d2d4d7d5g1f3g8f6c2c4c7c6b1c3g7g6c1g5f8g7e2e3e8g8f1d3c8e6d1e2b8d7e1g1h7h6g5h4e6g4.
d2d4d7d5g1f3g8f6c2c4c7c6e2e3c8f5b1c3e7e6f1d3f5d3d1d3b8d7e1g1f8d6e3e4d5e4c3e4f6e4.
d2d4d7d5g1f3g8f6c2c4c7c6e2e3c8f5d1b3d8c7c4d5c6d5f1b5b8c6c1d2e7e6e1g1f8d6d2b4e8g8.
d2d4d7d5g1f3g8f6c2c4c7c6e2e3c8f5f1d3f5d3d1d3e7e6e1g1b8d7b2b3f6e4f3d2d8h4g2g3h4h3.
d2d4d7d5g1f3g8f6c2c4d5c4b1c3a7a6a2a4c8f5e2e3e7e6f1c4f8b4e1g1e8g8d1e2f5g4f1d1b8d7.
d2d4d7d5g1f3g8f6c2c4d5c4b1c3a7a6d1a4b7b5a4c2b8c6e2e4e7e6c1g5c6d4f3d4d8d4a1d1d4c5.
d2d4d7d5g1f3g8f6c2c4d5c4b1c3c7c6a2a4c8f5e2e3e7e6f1c4f8b4e1g1b8d7d1e2f5g6e3e4b4c3.
d2d4d7d5g1f3g8f6c2c4d5c4b1c3c7c6a2a4c8f5e2e3e7e6f1c4f8b4e1g1b8d7f3h4e8g8h4f5e6f5.
d2d4d7d5g1f3g8f6c2c4d5c4b1c3c7c6a2a4c8f5f3e5e7e6f2f3f8b4e2e4f5e4f3e4f6e4c1d2d8d4.
d2d4d7d5g1f3g8f6c2c4d5c4b1c3c7c6a2a4c8g4f3e5g4h5g2g3e7e6f1g2f8b4e5c4f6d5d1b3b8a6.
d2d4d7d5g1f3g8f6c2c4d5c4b1c3e7e6e2e4f8b4c1g5c7c5f1c4c5d4f3d4d8a5g5d2a5c5c4b5c8d7.
d2d4d7d5g1f3g8f6c2c4d5c4d1a4c7c6a4c4c8f5b1c3e7e6g2g3b8d7f1g2f5c2e2e3f8e7e1g1e8g8.
d2d4d7d5g1f3g8f6c2c4d5c4e2e3c8g4f1c4e7e6e1g1b8d7b1c3f8d6e3e4e6e5d4e5d7e5c4e2g4f3.
d2d4d7d5g1f3g8f6c2c4d5c4e2e3e7e6f1c4c7c5e1g1a7a6a2a4b8c6d1e2c5d4f1d1f8e7e3d4e8g8.
d2d4d7d5g1f3g8f6c2c4d5c4e2e3e7e6f1c4c7c5e1g1a7a6a2a4b8c6d1e2c5d4f1d1f8e7e3d4e8g8.
d2d4d7d5g1f3g8f6c2c4d5c4e2e3e7e6f1c4c7c5e1g1a7a6c4b3b8c6b1c3b7b5d1e2c6a5d4c5a5b3.
d2d4d7d5g1f3g8f6c2c4e7e6b1c3b8d7c1g5f8e7e2e3e8g8a1c1a7a6a2a3c7c5d4c5d7c5c4d5e6d5.
d2d4d7d5g1f3g8f6c2c4e7e6b1c3c7c6c1g5d5c4e2e4b7b5e4e5h7h6g5h4g7g5f3g5f6d5g5f7d8h4.
d2d4d7d5g1f3g8f6c2c4e7e6b1c3c7c6e2e3b8d7f1d3d5c4d3c4b7b5c4d3a7a6e3e4c6c5e4e5c5d4.
d2d4d7d5g1f3g8f6c2c4e7e6b1c3f8e7c1f4e8g8e2e3c7c5d4c5e7c5f1e2d5c4e2c4a7a6d1e2b7b5.
d2d4d7d5g1f3g8f6c2c4e7e6b1c3f8e7c1g5h7h6g5f6e7f6e2e3e8g8d1b3c7c6a1d1b8d7f1d3b7b6.
d2d4d7d5g1f3g8f6c2c4e7e6b1c3f8e7c1g5h7h6g5h4e8g8a1c1f6e4h4e7d8e7e2e3c7c6f1d3e4c3.
d2d4d7d5g1f3g8f6c2c4e7e6b1c3f8e7d1c2e8g8e2e4d5e4c3e4b8d7f1d3f6e4d3e4d7f6e4d3e7b4.
d2d4d7d5g1f3g8f6c2c4e7e6c1g5b8d7e2e3f8e7b1c3e8g8a1c1b7b6c4d5e6d5d1a4c7c5a4c6a8b8.
d2d4d7d5g1f3g8f6c2c4e7e6c1g5f8e7e2e3b8d7b1c3e8g8a1c1f8e8d1c2h7h6g5h4c7c5c4d5f6d5.
d2d4d7d5g1f3g8f6c2c4e7e6c4d5e6d5b1c3c7c6d1c2g7g6c1g5f8g7e2e3c8f5f1d3f5d3c2d3e8g8.
d2d4d7d5g1f3g8f6c2c4e7e6e2e3c7c5f1d3b8c6e1g1d5c4d3c4a7a6b1c3b7b5c4d3c8b7a2a4b5b4.
d2d4d7d5g1f3g8f6c2c4e7e6g2g3d5c4f1g2b8c6e1g1a8b8b1c3b7b5e2e4f8e7c1f4e8g8a2a4a7a6.
d2d4d7d5g1f3g8f6e2e3c7c5c2c4e7e6f1d3b8c6e1g1a7a6b1c3d5c4d3c4b7b5c4d3c8b7a2a4b5b4.
d2d4d7d5g1f3g8f6e2e3c7c5c2c4e7e6f1d3b8c6e1g1d5c4d3c4a7a6a2a4f8e7b1c3e8g8b2b3c5d4.
d2d4d7d5g1f3g8f6e2e3c7c6f1d3g7g6b1d2f8g7e3e4d5e4d2e4e8g8e4g3f6d5c2c3c8g4h2h3g4f3.
d2d4d7d5g1f3g8f6e2e3c8f5f1d3e7e6d3f5e6f5d1d3d8c8b2b3b8a6e1g1f8e7c2c4e8g8b1c3c7c6.
d2d4d7d5g1f3g8f6e2e3e7e6f1d3c7c5e1g1b8c6b2b3f8d6c1b2e8g8b1d2d8e7f3e5f8d8a2a3c8d7.
d2d4d7d5g1f3g8f6g2g3c7c6f1g2c8f5e1g1e7e6c2c4b8d7b2b3f8e7b1c3f6e4c1b2d8a5d1c1e8g8.
d2d4d7d6c2c4e7e5b1c3e5d4d1d4b8d7g1f3g8f6b2b3f8e7c1b2c7c6e2e3e8g8f1e2d8b6e1g1d7c5.
d2d4d7d6c2c4e7e5g1f3e5e4f3g5f7f5b1c3g8f6h2h4b8c6g5h3g7g6e2e3f8h6g2g3c6e7b2b3c8e6.
d2d4d7d6e2e4e7e5d4e5d6e5d1d8e8d8g1f3f8d6b1c3c8e6c1e3g8f6e1c1f6g4e3g5f7f6g5h4b8d7.
d2d4d7d6e2e4g7g6b1c3c7c6c1e3f8g7d1d2b7b5f1d3b8d7f2f4d7b6b2b3g8f6g1f3a7a6a2a4b5b4.
d2d4d7d6e2e4g8f6b1c3g7g6g1f3f8g7f1e2e8g8e1g1b8c6a2a4e7e5d4d5c6e7a4a5h7h6a5a6c7c6.
d2d4d7d6e2e4g8f6b1c3g7g6g2g3f8g7f1g2e8g8g1e2b8d7h2h3e7e5e1g1e5d4e2d4f8e8f1e1d7c5.
d2d4d7d6e2e4g8f6f2f3d6d5e4e5f6d7f3f4c7c5g1f3b8c6c1e3c5d4f3d4c6d4e3d4d7b8b1c3b8c6.
d2d4d7d6g1f3g7g6c2c4f8g7e2e4b8d7b1c3e7e5d4d5a7a5f1e2g8f6e1g1e8g8d1c2d7c5c1g5h7h6.
d2d4e7e6c2c4b7b6b1c3c8b7a2a3f7f5d4d5g8f6g1f3f8e7g2g3f6e4f1g2e4c3b2c3b8a6f3d4e8g8.
d2d4e7e6c2c4b7b6e2e4c8b7d1c2d8h4b1d2f8b4f1d3f7f5g1f3b4d2e1f1h4h5c1d2g8f6e4f5b7f3.
d2d4e7e6c2c4b7b6e2e4c8b7f1d3b8c6g1e2c6b4e1g1b4d3d1d3g8e7b1c3d7d6d4d5d8d7c1e3e7g6.
d2d4e7e6c2c4b7b6e2e4c8b7f1d3f7f5e4f5f8b4e1f1g8f6d3e2e8g8c4c5b6c5a2a3b4a5d4c5f6d5.
d2d4e7e6c2c4d7d5b1c3f8e7g1f3g8f6c1g5e8g8e2e3b8d7d1c2c7c5c4d5f6d5g5e7d8e7c3d5e6d5.
d2d4e7e6c2c4d7d5g1f3d5c4d1a4b8d7b1c3a7a6a4c4b7b5c4d3c8b7e2e4g8f6a2a3c7c5e4e5f6d5.
d2d4e7e6c2c4f7f5b1c3f8b4d1c2g8f6e2e3e8g8f1d3d7d6g1e2c7c5a2a3b4c3e2c3b8c6d4c5d6c5.
d2d4e7e6c2c4f7f5b1c3g8f6e2e3d7d5f1d3c7c6f2f4f8e7g1f3e8g8e1g1b7b6c1d2c8a6d1e2a6b7.
d2d4e7e6c2c4f7f5e2e3g8f6b1c3d7d5g1h3c7c6c1d2f8d6d1c2e8g8e1c1d8e7f2f3d5c4e3e4f5e4.
d2d4e7e6c2c4f7f5g1f3g8f6b1c3f8e7d1c2d7d5b2b3e8g8e2e3c7c6f3e5e7b4c1d2b4c3d2c3f6e4.
d2d4e7e6c2c4f7f5g2g3f8b4c1d2b4e7f1g2g8f6b1c3e8g8g1f3f6e4e1g1b7b6d1c2c8b7f3e5e4c3.
d2d4e7e6c2c4f7f5g2g3f8b4c1d2b4e7f1g2g8f6b1c3e8g8g1f3f6e4e1g1e7f6c3e4f5e4f3e1f6d4.
d2d4e7e6c2c4f7f5g2g3g8f6b1c3f8e7f1g2e8g8g1f3d7d5e1g1c7c6d1c2b8d7c4d5c6d5c3b5d7b6.
d2d4e7e6c2c4f7f5g2g3g8f6f1g2f8b4c1d2b4e7b1c3e8g8g1f3d7d6e1g1d8e8d1c2e8h5e2e4e6e5.
d2d4e7e6c2c4f7f5g2g3g8f6f1g2f8e7b1c3e8g8d4d5e7b4c1d2e6e5e2e3d7d6g1e2a7a6d1c2d8e8.
d2d4e7e6c2c4f7f5g2g3g8f6f1g2f8e7b1c3e8g8e2e3d7d5g1e2c7c6b2b3e7d6e1g1d8e7d1c2f6e4.
d2d4e7e6c2c4f7f5g2g3g8f6f1g2f8e7b1c3e8g8e2e3d7d5g1e2c7c6b2b3f6e4e1g1b8d7c1b2d7f6.
d2d4e7e6c2c4f7f5g2g3g8f6f1g2f8e7b1c3e8g8e2e3d7d6g1e2c7c6e1g1e6e5d4d5d8e8e3e4e8h5.
d2d4e7e6c2c4f7f5g2g3g8f6f1g2f8e7g1f3d7d5e1g1e8g8d1c2c8d7b2b3a7a5c1a3c7c6a3e7d8e7.
d2d4e7e6c2c4f7f5g2g3g8f6f1g2f8e7g1f3e8g8e1g1d7d6b1c3d8e8f1e1e8g6e2e4f6e4c3e4f5e4.
d2d4e7e6c2c4f7f5g2g3g8f6f1g2f8e7g1f3e8g8e1g1f6e4b2b3e7f6c1b2b7b6b1d2c8b7f3e5d7d6.
d2d4e7e6c2c4f7f5g2g3g8f6f1g2f8e7g1h3e8g8e1g1d7d6b1c3d8e8e2e4f5e4h3f4c7c6c3e4f6e4.
d2d4e7e6c2c4f8b4c1d2b4d2d1d2g8f6b1c3d7d5f2f3b8c6e1c1e8g8e2e3d8e7c4d5f6d5e3e4d5c3.
d2d4e7e6c2c4f8b4c1d2b4d2d1d2g8f6b1c3d7d6e2e4e8g8e1c1b8c6d4d5c6e7f2f4e6d5c4d5c7c6.
d2d4e7e6c2c4f8b4c1d2d8e7e2e4d7d5e4e5b8c6g1f3b4d2d1d2d5c4b1c3g8h6d4d5c6e5f3e5e6d5.
d2d4e7e6c2c4f8b4c1d2d8e7g2g3b8c6g1f3g8f6b1c3b4c3d2c3f6e4a1c1d7d6d4d5e4c3c1c3c6d8.
d2d4e7e6c2c4g8f6b1c3d7d5c4d5e6d5c1g5c7c6e2e3f8e7f1d3b8d7g1e2f6h5g5e7d8e7g2g4h5f6.
d2d4e7e6c2c4g8f6b1c3f8b4d1c2b8c6g1f3d7d6c1d2e8g8a2a3b4c3d2c3d8e7e2e3e6e5d4d5c6b8.
d2d4e7e6c2c4g8f6b1c3f8b4e2e3e8g8g1f3c7c5f1d3d7d5e1g1d5c4d3c4b8d7d1e2b7b6c1d2c5d4.
d2d4e7e6c2c4g8f6b1c3f8b4e2e3e8g8g1f3c7c5f1d3d7d5e1g1d5c4d3c4b8d7d1e2b7b6f1d1c5d4.
d2d4e7e6c2c4g8f6g1f3b7b6g2g3c8a6b1d2f8b4d1b3d8e7f1g2a6b7e1g1b4d2c1d2e8g8a1d1d7d6.
d2d4e7e6c2c4g8f6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7b1c3d7d5c4d5e6d5f1g2e8g8e1g1b8d7.
d2d4e7e6c2c4g8f6g1f3b7b6g2g3c8b7f1g2f8e7e1g1e8g8b1c3f6e4d1c2e4c3c2c3b7e4c1f4b8c6.
d2d4e7e6c2c4g8f6g1f3d7d5b1c3c7c6e2e3b8d7d1c2f8d6b2b3e8g8f1e2b7b6e1g1c8b7c1b2f8e8.
d2d4e7e6c2c4g8f6g1f3d7d5b1c3f8e7c1f4e8g8e2e3c7c5d4c5e7c5a2a3b8c6b2b4c5e7c4d5f6d5.
d2d4e7e6c2c4g8f6g2g3f8b4c1d2b4e7f1g2d7d5g1f3e8g8e1g1c7c6d1c2b8d7b2b3b7b6f1d1c8a6.
d2d4e7e6e2e4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3d8c7d1g4f7f5g4g3c5d4c3d4g8e7e1d2e8g8.
d2d4e7e6e2e4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3d8c7d1g4f7f5g4g3g8e7c1d2e8g8f1d3b7b6.
d2d4e7e6e2e4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3d8c7d1g4f7f5g4h5g7g6h5d1b8c6g1f3c8d7.
d2d4e7e6e2e4d7d5b1d2c7c5e4d5e6d5g1f3a7a6d4c5f8c5d2b3c5a7c1g5g8f6f3d4e8g8f1e2d8d6.
d2d4e7e6e2e4d7d5b1d2c7c5e4d5e6d5g1f3g8f6f1b5c8d7b5d7b8d7e1g1f8e7d4c5d7c5f3d4d8d7.
d2d4e7e6e2e4d7d5b1d2d5e4d2e4b8d7g1f3g8f6e4f6d7f6c1g5f8e7f1d3c7c5e1g1c5d4f3d4e8g8.
d2d4e7e6e2e4d7d5e4d5e6d5g1f3g8f6c1g5c7c6f1d3c8e6e1g1b8d7f1e1d8b6b1d2f8e7a1b1h7h6.
d2d4e7e6e2e4d7d5e4e5c7c5c2c3b8c6g1f3c8d7f1e2g8e7b1a3c5d4c3d4e7f5a3c2c6b4c2e3f5e3.
d2d4e7e6g1f3f7f5g2g3g8f6f1g2f8e7e1g1e8g8c2c4d7d6b2b3a7a5c1b2d8e8b1d2b8c6a2a3e7d8.
d2d4e7e6g1f3g8f6c1g5c7c5e2e3f8e7f1d3b7b6c2c3c8b7b1d2c5d4c3d4f6d5d2c4e8g8h2h4f7f5.
d2d4e7e6g1f3g8f6c2c4b7b6b1c3c8b7c1g5h7h6g5f6d8f6e2e4f8b4f1d3c7c5e1g1c5d4c3b5f6d8.
d2d4e7e6g1f3g8f6c2c4b7b6g2g3c8a6b2b3a6b7f1g2f8b4c1d2a7a5e1g1e8g8d1c2c7c5f1d1b4d2.
d2d4e7e6g1f3g8f6c2c4b7b6g2g3c8b7f1g2f8e7e1g1e8g8b1c3f6e4d1c2e4c3c2c3b7e4b2b3c7c5.
d2d4e7e6g1f3g8f6c2c4b7b6g2g3c8b7f1g2f8e7e1g1e8g8b2b3d7d5c4d5e6d5c1b2b8d7b1c3f8e8.
d2d4e7e6g1f3g8f6c2c4b7b6g2g3c8b7f1g2f8e7e1g1e8g8d1c2c7c5b2b3c5d4f3d4b7g2g1g2d7d5.
d2d4e7e6g1f3g8f6c2c4d7d5c4d5e6d5b1c3c7c6d1c2c8g4c1g5b8d7e2e3f8d6f1d3d8c7e1c1h7h6.
d2d4e7e6g1f3g8f6c2c4f8b4c1d2c7c5d2b4c5b4g2g3b7b6f1g2c8b7e1g1e8g8b1d2d7d6d1b3a7a5.
d2d4e7e6g2g3c7c5g1f3c5d4f3d4d7d5f1g2g8f6e1g1e6e5d4b3c8e6c2c4b8c6c4d5f6d5b1d2f8e7.
d2d4f7f5b1c3g8f6c1g5d7d5g5f6e7f6e2e3c8e6f1d3b8c6a2a3d8d7g1f3f8d6c3b5d6e7e1g1c6d8.
d2d4f7f5c1g5c7c6e2e3g7g6c2c4f8g7b1c3d7d6f1d3d8a5g1e2b8d7e1g1e7e5d4e5d6e5a2a3h7h6.
d2d4f7f5c2c4g8f6g2g3e7e6f1g2d7d5g1f3c7c6e1g1f8d6f3e5e8g8c1f4f6g4e5g4d6f4g3f4f5g4.
d2d4f7f5c2c4g8f6g2g3e7e6f1g2f8b4c1d2b4e7g1f3e8g8e1g1c7c6d1b3b8a6b1c3d8e8d4d5a6c5.
d2d4f7f5e2e4f5e4b1c3g8f6c1g5c7c6f2f3d8a5g5f6e7f6f3e4f8b4d1f3d7d5g1e2e8g8e4d5a5d5.
d2d4f7f5e2e4f5e4f2f3e4f3g1f3g8f6f1d3d7d6e1g1c8g4b1c3b8c6c1e3d8d7d4d5c6e5d3b5c7c6.
d2d4f7f5g1f3g8f6g2g3g7g6f1g2f8g7e1g1e8g8c2c4c7c6b1c3b8a6b2b3d7d6c1b2c8d7f1e1d8a5.
d2d4f7f5g2g3g8f6f1g2e7e6g1f3f8e7c2c4e8g8b1c3d7d6c1f4d8e8a1c1b8c6d4d5c6d8c3b5e8d7.
d2d4f7f5g2g3g8f6f1g2e7e6g1f3f8e7e1g1e8g8c2c4c7c6b1c3d7d5c1g5b8d7e2e3d8e8d1c2g8h8.
d2d4f7f5g2g3g8f6f1g2g7g6g1f3f8g7b2b3e8g8c1b2d7d5c2c4c7c6e1g1c8e6f3g5e6f7b1c3d8e8.
d2d4f7f5g2g3g8f6f1g2g7g6g1f3f8g7e1g1e8g8b2b4f6e4c2c4e7e6c1b2b7b6b1c3c8b7a1c1a7a5.
d2d4f7f5g2g3g8f6f1g2g7g6g1h3f8g7e1g1e8g8c2c4b8c6b1c3e7e6d4d5c6e5b2b3e5f7c1a3f8e8.
d2d4f7f5g2g3g8f6f1g2g7g6g1h3f8g7h3f4b8c6d4d5c6e5b1c3c7c6e2e4f5e4c3e4f6e4g2e4c6d5.
d2d4g7g6c2c4f8g7g1f3c7c5g2g3c5d4f3d4b8c6d4c2b7b6f1g2c8a6b1a3a8c8a1b1g8f6e1g1e8g8.
d2d4g7g6e2e4f8g7b1c3d7d6c1e3c7c6d1d2b7b5f2f3b8d7h2h4h7h5g1h3d8a5h3g5g8h6a2a3a8b8.
d2d4g7g6e2e4f8g7c2c3c7c6f1d3d7d6f2f4d6d5e4e5h7h5g1f3g8h6c1e3c8f5d3f5h6f5e3f2b8a6.
d2d4g7g6e2e4f8g7c2c4d7d6b1c3b8d7g1e2e7e5c1e3g8e7d1d2e8g8e1c1a7a6h2h4e5d4e2d4d7e5.
d2d4g7g6e2e4f8g7c2c4d7d6b1c3e7e5d4e5d6e5d1d8e8d8f2f4b8c6g1f3c6d4e1f2e5f4c1f4d4e6.
d2d4g7g6e2e4f8g7c2c4d7d6b1c3g8f6f2f3b8d7c1e3e8g8f1d3e7e5g1e2f6h5d4e5d6e5e1g1c7c6.
d2d4g7g6e2e4f8g7g1f3d7d6b1c3g8f6f1e2e8g8e1g1b8d7e4e5f6e8c1f4d7b6f1e1c7c6h2h3e8c7.
d2d4g7g6e2e4f8g7g1f3d7d6c2c3g8f6f1d3e8g8e1g1b8c6c1g5h7h6g5h4e7e5d4e5d6e5b1a3c8e6.
d2d4g7g6e2e4f8g7g1f3d7d6f1e2e7e6c2c3b8d7e1g1g8e7b1d2b7b6a2a4a7a6f1e1c8b7e2d3e8g8.
d2d4g7g6g1f3f7f5g2g3f8g7f1g2g8f6e1g1e8g8c2c4d7d6d4d5c7c5b1c3b8a6f3e1a8b8e1c2a6c7.
d2d4g8f6b1c3d7d5c1g5c8f5f2f3f5g6e2e4d5e4d1d2e7e6f3e4f8b4d2e3f6g4e3d2g4f6d2e3f6g4.
d2d4g8f6b1c3d7d5c1g5c8f5g5f6g7f6e2e3c7c6f1d3f5g6f2f4g6d3d1d3e7e6e3e4d5e4c3e4f6f5.
d2d4g8f6b1c3d7d5c1g5h7h6g5f6e7f6e2e3c7c6f1d3f8d6d1f3e8g8g1e2f8e8e1c1b7b5g2g4b5b4.
d2d4g8f6b1c3d7d5c1g5h7h6g5f6e7f6e2e4f8b4e4d5d8d5g1f3e8g8f1e2d5a5d1d2b8d7a2a3d7b6.
d2d4g8f6b1c3g7g6e2e4d7d6g1f3f8g7f1c4e8g8e1g1c8g4h2h3g4f3d1f3b8c6c1e3e7e5d4e5c6e5.
d2d4g8f6c1g5d7d5g5f6e7f6e2e3c8e6b1d2c7c6f1d3f6f5d1f3g7g6g1e2b8d7e1g1f8d6c2c4d7f6.
d2d4g8f6c1g5d7d5g5f6e7f6e2e3c8e6g2g3f6f5f1d3c7c6b1d2b8d7g1e2f8d6e1g1e8g8c2c3d7f6.
d2d4g8f6c1g5e7e6e2e3h7h6g5h4c7c5c2c3c5d4c3d4g7g5h4g3f6e4b1c3e4g3h2g3d7d5f1d3f8g7.
d2d4g8f6c1g5e7e6e2e4h7h6g5f6d8f6b1c3d7d6d1d2g7g5f1c4b8c6g1e2f8g7a1d1c8d7e1g1e8c8.
d2d4g8f6c1g5e7e6e2e4h7h6g5f6d8f6g1f3d7d6b1c3g7g6d1d2f6e7e1c1a7a6h2h4f8g7g2g3b7b5.
d2d4g8f6c1g5f6e4g5f4c7c5f2f3e4f6d4d5e7e6b1c3f6h5f4e3d7d6d1d2e6e5g2g4h5f6e3f2a7a6.
d2d4g8f6c1g5f6e4g5f4d7d5b1d2e4d2d1d2c8f5e2e3e7e6g1f3f8e7c2c4e8g8a1c1c7c6f1e2b8d7.
d2d4g8f6c1g5f6e4h2h4c7c5d4c5d8a5b1d2e4g5h4g5g7g6c2c3a5c5g1f3f8g7e2e3a7a6a2a4d7d5.
d2d4g8f6c1g5g7g6g5f6e7f6e2e3d7d5c2c4d5c4f1c4f8d6b1c3e8g8g1f3b8d7e1g1d7b6c4b3f8e8.
d2d4g8f6c2c4b7b6b1c3c8b7f2f3d7d5c4d5f6d5e2e4d5c3b2c3e7e6f1b5b8d7g1e2f8e7e1g1a7a6.
d2d4g8f6c2c4c7c5d4d5b7b5c4b5a7a6b5a6c8a6b1c3d7d6g1f3g7g6g2g3f8g7f1g2b8d7e1g1d7b6.
d2d4g8f6c2c4c7c5d4d5b7b5c4b5a7a6b5a6g7g6b1c3c8a6e2e4a6f1e1f1d7d6g2g3f8g7f1g2b8d7.
d2d4g8f6c2c4c7c5d4d5b7b5c4b5a7a6b5a6g7g6g2g3f8g7f1g2d7d6g1h3b8a6h3f4d8b6e1g1e8g8.
d2d4g8f6c2c4c7c5d4d5b7b5g1f3g7g6c4b5a7a6b5b6d8b6b1c3d7d6f3d2f8g7e2e4e8g8f1e2a6a5.
d2d4g8f6c2c4c7c5d4d5b7b5g1f3g7g6d1c2f8g7e2e4d7d6c4b5e8g8b1c3a7a6a2a4a6b5f1b5b8a6.
d2d4g8f6c2c4c7c5d4d5d7d6b1c3g7g6e2e4f8g7c1g5h7h6g5h4g6g5h4g3d8a5f1d3f6e4d3e4g7c3.
d2d4g8f6c2c4c7c5d4d5d7d6b1c3g7g6e2e4f8g7f1d3e8g8g1f3c8g4h2h3g4f3d1f3b8d7f3d1e7e6.
d2d4g8f6c2c4c7c5d4d5d7d6b1c3g7g6g1f3f8g7e2e4e8g8c1f4a7a6a2a4d8a5f4d2e7e6f1e2e6d5.
d2d4g8f6c2c4c7c5d4d5e7e5b1c3d7d6e2e4g7g6f1d3b8a6g1e2a6b4d3b1f8g7h2h3c8d7c1e3e8g8.
d2d4g8f6c2c4c7c5d4d5e7e5b1c3d7d6e2e4g7g6f1e2f8g7c1g5b8a6g1f3h7h6g5d2c8g4a2a3g4f3.
d2d4g8f6c2c4c7c5d4d5e7e5b1c3d7d6e2e4g7g6f2f3b8a6c1e3a6c7d1d2a7a6a2a4b7b6f1d3a8b8.
d2d4g8f6c2c4c7c5d4d5e7e5b1c3d7d6e2e4g7g6f2f3f6h5c1e3f8g7d1d2e8g8g2g4h5f4g1e2b8d7.
d2d4g8f6c2c4c7c5d4d5e7e5b1c3d7d6e2e4g7g6g1f3f8g7c1g5b8a6f1e2a6c7f3d2c8d7a2a4b7b6.
d2d4g8f6c2c4c7c5d4d5e7e5b1c3d7d6g2g3g7g6f1h3b8d7g1f3f8g7e1g1a7a6e2e4e8g8f1e1f6e8.
d2d4g8f6c2c4c7c5d4d5e7e6b1c3e6d5c4d5d7d6e2e4g7g6f2f4f8g7f1b5f6d7a2a4d8h4e1f1e8g8.
d2d4g8f6c2c4c7c5d4d5e7e6b1c3e6d5c4d5d7d6e2e4g7g6g1f3f8g7f1d3e8g8h2h3a7a6a2a4b8d7.
d2d4g8f6c2c4c7c5d4d5e7e6b1c3e6d5c4d5d7d6e2e4g7g6g1f3f8g7f1e2e8g8e1g1f8e8f3d2b8a6.
d2d4g8f6c2c4c7c5d4d5e7e6b1c3e6d5c4d5d7d6e2e4g7g6g1f3f8g7h2h3e8g8f1d3b7b5c3b5f8e8.
d2d4g8f6c2c4c7c5d4d5e7e6b1c3e6d5c4d5d7d6g1f3g7g6c1g5f8g7f3d2h7h6g5h4g6g5h4g3f6h5.
d2d4g8f6c2c4c7c5d4d5e7e6b1c3e6d5c4d5d7d6g1f3g7g6f3d2b8d7g2g3f8g7f1g2e8g8e1g1d8e7.
d2d4g8f6c2c4c7c5d4d5e7e6b1c3e6d5c4d5d7d6g1f3g7g6g2g3f8g7f1g2e8g8e1g1a7a6a2a4b8d7.
d2d4g8f6c2c4c7c5d4d5g7g6b1c3d7d6e2e4b7b5c4b5f8g7g1f3e8g8f1e2a7a6b5a6c8a6e1g1d8c7.
d2d4g8f6c2c4c7c6b1c3d7d5c4d5c6d5g1f3b8c6c1f4c8f5e2e3e7e6f1b5f8b4f3e5d8a5b5c6b7c6.
d2d4g8f6c2c4c7c6b1c3d7d6g1f3b8d7g2g3e7e5f1g2f8e7d1c2e8g8e1g1f8e8b2b3e7f8e2e4a7a6.
d2d4g8f6c2c4c7c6b1c3e7e6g1f3d7d5c1g5b8d7e2e4d5e4c3e4d8b6e4f6g7f6g5c1e6e5f1d3e5d4.
d2d4g8f6c2c4c7c6g1f3d7d5b1c3e7e6c1g5b8d7e2e4d5e4c3e4f8e7e4c3e8g8d1c2b7b6e1c1c8b7.
d2d4g8f6c2c4c7c6g1f3d7d5e2e3e7e6f1d3b8d7b1c3d5c4d3c4b7b5c4d3a7a6e1g1c6c5a2a4b5b4.
d2d4g8f6c2c4c7c6g1f3d7d5e2e3e7e6f1d3b8d7b1d2f8e7e1g1e8g8b2b3b7b6c1b2c8b7d1e2c6c5.
d2d4g8f6c2c4d7d5g1f3e7e6b1c3b8d7e2e3f8e7f1d3d5c4d3c4c7c5e1g1e8g8f1e1a7a6a2a4d8c7.
d2d4g8f6c2c4d7d6b1c3b8d7c1g5h7h6g5h4g7g5h4g3f6h5e2e3h5g3h2g3f8g7f1d3d7f6d1d2c7c6.
d2d4g8f6c2c4d7d6b1c3b8d7e2e4e7e5d4d5d7c5d1c2a7a5g2g3f8e7f1g2e8g8g1e2f6h5e1g1e7g5.
d2d4g8f6c2c4d7d6b1c3b8d7e2e4e7e5g1f3f8e7g2g3e8g8f1g2c7c6e1g1a7a6b2b3f8e8c1b2e7f8.
d2d4g8f6c2c4d7d6b1c3b8d7e2e4e7e5g1f3g7g6f1e2f8g7e1g1e8g8c1g5c7c6d1d2d8b6c4c5d6c5.
d2d4g8f6c2c4d7d6b1c3b8d7g1f3c7c6g2g3e7e5f1g2f8e7e1g1e8g8d1c2f8e8b2b3e7f8c1b2a7a6.
d2d4g8f6c2c4d7d6b1c3b8d7g1f3g7g6e2e4e7e5f1e2f8g7e1g1e8g8f1e1c7c6e2f1f6e8a1b1e8c7.
d2d4g8f6c2c4d7d6b1c3e7e5e2e3b8d7f1d3g7g6g1e2f8g7e1g1e8g8f2f4f8e8e2g3c7c6g1h1d7f8.
d2d4g8f6c2c4d7d6b1c3e7e5g1f3b8d7c1g5f8e7e2e3c7c6f1e2e8g8e1g1f8e8d1c2d8c7h2h3d7f8.
d2d4g8f6c2c4d7d6b1c3e7e5g1f3b8d7c1g5f8e7e2e3e8g8d1c2c7c6f1d3e5d4e3d4f8e8e1g1h7h6.
d2d4g8f6c2c4d7d6b1c3e7e5g1f3b8d7c1g5h7h6g5h4g7g5d4e5g5h4e5f6d8f6c3d5f6b2a1b1b2a2.
d2d4g8f6c2c4d7d6b1c3e7e5g1f3b8d7e2e4g7g6f1e2f8g7e1g1e8g8f1e1c7c6e2f1f6g4h2h3e5d4.
d2d4g8f6c2c4d7d6b1c3e7e5g1f3b8d7g2g3g7g6f1g2f8g7e1g1e8g8e2e4c7c6h2h3f6h5c1e3d8e7.
d2d4g8f6c2c4d7d6b1c3e7e5g1f3b8d7g2g3g7g6f1g2f8g7e1g1e8g8e2e4f8e8c1e3f6g4e3g5f7f6.
d2d4g8f6c2c4d7d6b1c3e7e5g1f3b8d7g2g3g7g6f1g2f8g7e1g1e8g8e2e4f8e8c1e3f6g4e3g5f7f6.
d2d4g8f6c2c4d7d6b1c3e7e5g1f3e5e4f3g5c8f5d1c2h7h6g5e4f6e4c3e4d8h4e4d6f8d6c2f5d6b4.
d2d4g8f6c2c4d7d6b1c3g7g6e2e4f8g7f2f3e8g8c1e3a7a6d1d2c7c6f1d3e7e5d4e5d6e5c3a4b7b5.
d2d4g8f6c2c4d7d6g1f3b8d7b1c3c7c6e2e4e7e5f1e2f8e7e1g1a7a6d1c2e8g8f1d1d8c7c1g5h7h6.
d2d4g8f6c2c4d7d6g1f3b8d7b1c3e7e5e2e4c7c6f1e2f8e7e1g1e8g8d1c2f8e8b2b3e7f8c1b2f6h5.
d2d4g8f6c2c4d7d6g1f3b8d7b1c3e7e5e2e4f8e7f1e2e8g8e1g1c7c6d1c2f8e8f1d1e7f8a1b1a7a5.
d2d4g8f6c2c4d7d6g1f3b8d7g2g3e7e5f1g2c7c6d4e5d6e5e1g1f8c5b1c3e8g8d1c2d8e7f3h4f8e8.
d2d4g8f6c2c4d7d6g1f3g7g6b1c3f8g7e2e4e7e5f1e2e8g8e1g1b8c6c1e3f6g4e3g5f7f6g5c1e5d4.
d2d4g8f6c2c4d7d6g1f3g7g6b1c3f8g7e2e4e8g8f1e2b8d7e1g1e7e5f1e1e5d4f3d4d7c5e2f1f8e8.
d2d4g8f6c2c4d7d6g1f3g7g6b1c3f8g7g2g3e8g8f1g2b8d7e1g1e7e5d1c2c7c6f1d1f8e8d4e5d6e5.
d2d4g8f6c2c4d7d6g1f3g7g6b1c3f8g7g2g3e8g8f1g2b8d7e1g1e7e5e2e4f8e8c1e3f6g4e3g5f7f6.
d2d4g8f6c2c4d7d6g1f3g7g6g2g3f8g7f1g2e8g8e1g1b8c6b1c3c8g4h2h3g4f3g2f3f6d7f3g2c6d4.
d2d4g8f6c2c4e7e5d4e5f6g4c1f4b8c6g1f3f8b4b1d2d8e7e2e3g4e5f3e5c6e5f1e2e8g8e1g1d7d6.
d2d4g8f6c2c4e7e5d4e5f6g4g1f3f8c5e2e3b8c6b1c3g4e5f3e5c6e5f1e2e8g8a2a3a7a5e1g1d7d6.
d2d4g8f6c2c4e7e5d4e5f6g4g1f3f8c5e2e3b8c6f1e2g4e5f3e5c6e5e1g1e8g8b1c3d7d6c3a4c5b6.
d2d4g8f6c2c4e7e6b1c3c7c5d4d5e6d5c4d5d7d6e2e4g7g6f2f4f8g7f1b5f6d7a2a4e8g8g1f3a7a6.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5b8d7e2e3c7c6c4d5e6d5f1d3f8e7d1c2e8g8g1f3h7h6g5h4f8e8.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5b8d7e2e3c7c6c4d5e6d5f1d3f8e7g1e2e8g8e2g3f6e8h2h4d7f6.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5b8d7e2e3f8e7g1f3e8g8a1c1c7c6d1c2a7a6a2a3f8e8f1d3h7h6.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5b8d7e2e3f8e7g1f3e8g8a1c1c7c6d1c2a7a6a2a3h7h6g5h4f8e8.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5b8d7e2e3f8e7g1f3e8g8a1c1c7c6f1d3d5c4d3c4f6d5g5e7d8e7.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5b8d7e2e3f8e7g1f3e8g8a1c1c7c6f1d3d5c4d3c4f6d5g5e7d8e7.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5b8d7e2e3f8e7g1f3e8g8a1c1c7c6f1d3d5c4d3c4f6d5g5e7d8e7.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5b8d7e2e3f8e7g1f3e8g8a1c1c7c6f1d3d5c4d3c4f6d5g5e7d8e7.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5b8d7e2e3f8e7g1f3e8g8a1c1c7c6f1d3d5c4d3c4f6d5g5e7d8e7.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5b8d7e2e3f8e7g1f3e8g8a1c1c7c6f1d3d5c4d3c4f6d5g5e7d8e7.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5b8d7e2e3f8e7g1f3e8g8a1c1c7c6f1d3d5c4d3c4f6d5g5e7d8e7.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5b8d7e2e3f8e7g1f3e8g8d1c2c7c5c4d5f6d5c3d5e6d5g5e7d8e7.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5b8d7g1f3c7c6e2e3d8a5g5f6d7f6f3d2f8b4d1c2e8g8f1d3b4c3.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5b8d7g1f3h7h6g5h4f8e7e2e3e8g8a1c1a7a6b2b3b7b6c4d5e6d5.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5c7c5e2e3c5d4e3d4f8e7g1f3e8g8a1c1b7b6f1d3b8c6e1g1c6b4.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5f8e7e2e3b8d7g1f3e8g8a1c1c7c6f1d3d5c4d3c4f6d5g5e7d8e7.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5f8e7e2e3b8d7g1f3e8g8a1c1c7c6f1d3h7h6g5h4d5c4d3c4b7b5.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5f8e7e2e3b8d7g1f3e8g8d1c2c7c6a1d1f8e8a2a3d5c4f1c4f6d5.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5f8e7e2e3e8g8g1f3b8d7a1c1c7c6a2a3a7a6d1c2f8e8f1d3h7h6.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5f8e7e2e3e8g8g1f3b8d7a1c1c7c6d1c2a7a6c4d5f6d5g5e7d8e7.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5f8e7e2e3e8g8g1f3b8d7a1c1c7c6f1d3d5c4d3c4f6d5g5e7d8e7.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5f8e7e2e3e8g8g1f3h7h6g5h4b7b6f1d3c8b7e1g1b8d7a1c1c7c5.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5f8e7e2e3e8g8g1f3h7h6g5h4f6e4h4e7d8e7c4d5e4c3b2c3e6d5.
d2d4g8f6c2c4e7e6b1c3d7d5c1g5f8e7g1f3e8g8e2e3h7h6g5h4b7b6f1d3c8b7e1g1b8d7a1c1c7c5.
d2d4g8f6c2c4e7e6b1c3d7d5c4d5e6d5c1g5f8e7d1c2e8g8e2e3f8e8f1d3b8d7g1f3d7f8e1g1c7c6.
d2d4g8f6c2c4e7e6b1c3d7d5c4d5e6d5c1g5f8e7e2e3c7c6f1d3b8d7d1c2f6h5g5e7d8e7g1e2d7b6.
d2d4g8f6c2c4e7e6b1c3d7d5c4d5e6d5c1g5f8e7e2e3e8g8d1c2b8d7g1f3c7c6f1d3f8e8e1g1d7f8.
d2d4g8f6c2c4e7e6b1c3d7d5c4d5e6d5c1g5f8e7e2e3e8g8f1d3c7c6d1c2b8d7g1e2f8e8e1g1d7f8.
d2d4g8f6c2c4e7e6b1c3d7d5c4d5e6d5c1g5f8e7e2e3e8g8f1d3c7c6d1c2b8d7g1e2f8e8e1g1d7f8.
d2d4g8f6c2c4e7e6b1c3d7d5c4d5e6d5c1g5f8e7e2e3h7h6g5h4e8g8f1d3b7b6g1f3c8b7e1g1c7c5.
d2d4g8f6c2c4e7e6b1c3d7d5e2e3b8d7g1f3f8e7f1d3c7c5c4d5e6d5d4c5e8g8e1g1d7c5d3c2c8g4.
d2d4g8f6c2c4e7e6b1c3d7d5g1f3b8d7c1g5f8b4c4d5e6d5e2e3c7c5f1d3d8a5e1g1c5c4d3f5e8g8.
d2d4g8f6c2c4e7e6b1c3d7d5g1f3b8d7c4d5e6d5c1g5f8e7e2e3e8g8d1c2c7c6f1d3f8e8h2h3f6e4.
d2d4g8f6c2c4e7e6b1c3d7d5g1f3b8d7e2e3a7a6a2a4f8b4c1d2c7c6f1d3d5c4d3c4d8a5e1g1e8g8.
d2d4g8f6c2c4e7e6b1c3d7d5g1f3c7c5c4d5c5d4d1d4e6d5e2e4b8c6f1b5a7a6b5c6b7c6f3e5c8b7.
d2d4g8f6c2c4e7e6b1c3d7d5g1f3c7c5c4d5c5d4d1d4e6d5e2e4b8c6f1b5f6e4e1g1e4f6f1e1f8e7.
d2d4g8f6c2c4e7e6b1c3d7d5g1f3c7c6e2e3a7a6c4c5b8d7f1d3d8c7e1g1e6e5d4e5d7e5f3e5c7e5.
d2d4g8f6c2c4e7e6b1c3d7d5g1f3f8b4c1g5e8g8e2e3c7c5c4d5e6d5d4c5b8d7a1c1d7c5d1d4b4c3.
d2d4g8f6c2c4e7e6b1c3f8b4a2a3b4c3b2c3c7c5e2e3b7b6g1e2b8c6e2g3e8g8f1d3c8a6e3e4f6e8.
d2d4g8f6c2c4e7e6b1c3f8b4a2a3b4c3b2c3c7c5e2e3b8c6f1d3e6e5g1e2d7d6e1g1d8e7e3e4f6d7.
d2d4g8f6c2c4e7e6b1c3f8b4a2a3b4c3b2c3c7c5e2e3b8c6f1d3e6e5g1e2d7d6e3e4f6h5e1g1g7g5.
d2d4g8f6c2c4e7e6b1c3f8b4a2a3b4c3b2c3c7c5e2e3b8c6f1d3e8g8g1e2d7d6e3e4f6e8e1g1b7b6.
d2d4g8f6c2c4e7e6b1c3f8b4a2a3b4c3b2c3c7c5e2e3d8a5c1d2f6e4g1f3e4d2d1d2e8g8f1d3d7d6.
d2d4g8f6c2c4e7e6b1c3f8b4a2a3b4c3b2c3c7c5f2f3b8c6d4d5c6a5e2e4e6e5f1d3b7b6c1g5c8a6.
d2d4g8f6c2c4e7e6b1c3f8b4a2a3b4c3b2c3c7c5g1f3e8g8c1g5d7d6d1c2f8e8e2e4h7h6g5e3d8a5.
d2d4g8f6c2c4e7e6b1c3f8b4a2a3b4c3b2c3e8g8f2f3d7d5c4d5e6d5e2e3c8f5g1e2b8d7e2g3f5g6.
d2d4g8f6c2c4e7e6b1c3f8b4a2a3b4c3b2c3e8g8f2f3f6h5g1h3f7f5e2e4c7c5e4e5b8c6f3f4g7g6.
d2d4g8f6c2c4e7e6b1c3f8b4a2a3b4c3b2c3f6e4d1c2f7f5g1h3d7d6f2f3e4f6e2e4f5e4f3e4e6e5.
d2d4g8f6c2c4e7e6b1c3f8b4a2a3b4c3b2c3f6e4d1c2f7f5g1h3e8g8f2f3e4f6c4c5b7b6c5b6c7b6.
d2d4g8f6c2c4e7e6b1c3f8b4a2a3b4c3b2c3f6e4e2e3f7f5d1h5g7g6h5h6d7d6f2f3e4f6e3e4e6e5.
d2d4g8f6c2c4e7e6b1c3f8b4a2a3b4c3b2c3f6e4g1h3c7c5e2e3d8a5c1d2c5d4c3d4e4d2d1d2a5d2.
d2d4g8f6c2c4e7e6b1c3f8b4c1d2b7b6f2f3b8c6a2a3b4e7e2e3e8g8f1d3d7d5c4d5e6d5g1e2f6h5.
d2d4g8f6c2c4e7e6b1c3f8b4c1g5c7c5d4d5b4c3b2c3e6e5a1c1d7d6e2e3b8d7f2f3h7h6g5h4g7g5.
d2d4g8f6c2c4e7e6b1c3f8b4c1g5h7h6g5h4c7c5d4d5d7d6e2e3e6e5g1e2b8d7a2a3b4a5d1c2e8g8.
d2d4g8f6c2c4e7e6b1c3f8b4d1b3c7c5d4c5b4c5g1f3d7d5c4d5e6d5c1g5c8e6g5f6g7f6e1c1b8d7.
d2d4g8f6c2c4e7e6b1c3f8b4d1b3c7c5d4c5b8a6a2a3b4c3b3c3a6c5f2f3a7a5e2e4e8g8c1f4d8b6.
d2d4g8f6c2c4e7e6b1c3f8b4d1b3c7c5d4c5b8a6g1f3e8g8c1g5b4c5e2e3b7b6f1e2c8b7e1g1c5e7.
d2d4g8f6c2c4e7e6b1c3f8b4d1b3c7c5d4c5b8c6g1f3b4c5c1g5h7h6g5f6d8f6e2e3b7b6f1e2c8b7.
d2d4g8f6c2c4e7e6b1c3f8b4d1b3d8e7a2a3b4c3b3c3b7b6f2f3d7d5c4d5f6d5c3c2e7h4g2g3h4d4.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2b8c6g1f3d7d5c1g5h7h6g5f6d8f6e2e3e8g8a2a3b4c3c2c3f8e8.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2b8c6g1f3d7d5c4d5e6d5a2a3b4a5c1g5c6e7g5f6g7f6e2e3c7c6.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2b8c6g1f3d7d6c1d2e8g8a2a3b4c3d2c3a7a5e2e3d8e7f1d3e6e5.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2c7c5d4c5b8a6e2e3a6c5c1d2e8g8g1f3b7b6f1e2c8a6e1g1d7d5.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2c7c5d4c5d8c7a2a3b4c5b2b4c5e7c3b5c7c6g1f3d7d6f3d4c6d7.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2c7c5d4c5e8g8a2a3b4c5g1f3b7b6c1f4c8b7a1d1d7d5c4d5e6d5.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2c7c5d4c5e8g8c1f4b4c5e2e3b8c6g1f3d7d5a2a3d8e7f4g5f8d8.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2c7c5d4c5e8g8c1f4b4c5g1f3b8c6e2e3d7d5a1d1d8a5a2a3c5e7.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2c7c5d4c5e8g8c1f4b8a6f4d6f8e8a2a3d8a5a1c1b4c3c2c3a5c3.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2c7c5d4c5e8g8c1g5b8a6a2a3b4c5g1f3b7b6g2g3c8b7f1g2d8c8.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2c7c5d4c5e8g8g1f3b8a6a2a3b4c3c2c3a6c5e2e3a7a5b2b3d7d5.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2c7c5d4c5e8g8g1f3b8a6c1d2a6c5e2e3b7b6f1e2c8b7e1g1c5e4.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2d7d5a2a3b4c3c2c3b8c6e2e3e6e5d4e5f6e4c3d3e4c5d3c2d5c4.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2d7d5c4d5d8d5e2e3c7c5a2a3b4c3b2c3b8c6g1f3e8g8c3c4d5d6.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2d7d5c4d5d8d5e2e3c7c5a2a3b4c3b2c3b8d7f2f3c5d4c3d4d7b6.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2d7d5c4d5d8d5e2e3c7c5a2a3b4c3b2c3e8g8g1f3c5d4c3d4b7b6.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2d7d5c4d5d8d5e2e3c7c5c1d2b4c3b2c3e8g8g1f3b8c6c3c4d5d6.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2d7d5c4d5d8d5e2e3c7c5c1d2b4c3d2c3c5d4c3d4b8c6d4f6g7f6.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2d7d5c4d5d8d5e2e3c7c5c1d2b4c3d2c3c5d4c3d4b8c6d4f6g7f6.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2d7d5c4d5d8d5g1f3d5f5c2d1c7c5e2e3c5d4e3d4e8g8f1d3f5h5.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2d7d5c4d5e6d5a2a3b4c3b2c3e8g8c1g5c7c5e2e3b8d7f1d3d8a5.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2d7d5c4d5e6d5c1d2e8g8e2e3b8c6f1d3f8e8g1e2b4d6a2a3c8g4.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2d7d5c4d5e6d5c1g5h7h6g5f6d8f6a2a3b4c3c2c3c7c6e2e3e8g8.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2d7d5c4d5e6d5c1g5h7h6g5f6d8f6a2a3b4c3c2c3c7c6g1f3e8g8.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2d7d5c4d5e6d5c1g5h7h6g5f6d8f6a2a3b4c3c2c3e8g8e2e3c7c6.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2d7d5c4d5e6d5c1g5h7h6g5h4b8d7e2e3e8g8f1d3c7c5d4c5d7c5.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2d7d5c4d5e6d5c1g5h7h6g5h4c7c5d4c5b8c6e2e3g7g5h4g3d8a5.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2d7d5c4d5e6d5c1g5h7h6g5h4c7c5d4c5g7g5h4g3f6e4e2e3d8a5.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2d7d5c4d5e6d5c1g5h7h6g5h4c7c5d4c5g7g5h4g3f6e4e2e3d8a5.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2d7d5c4d5e6d5g1f3c7c5a2a3b4c3b2c3e8g8c1g5b8d7e2e3d8a5.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2e8g8a2a3b4c3c2c3b7b6c1g5c7c5d4c5b6c5e2e3b8c6g1h3h7h6.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2e8g8a2a3b4c3c2c3b7b6c1g5c7c5d4c5b6c5e2e3d7d6f1d3b8d7.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2e8g8a2a3b4c3c2c3b7b6c1g5c7c5d4c5b6c5e2e3d7d6f1d3b8d7.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2e8g8a2a3b4c3c2c3b7b6c1g5c7c5d4c5b6c5e2e3d7d6f1d3b8d7.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2e8g8a2a3b4c3c2c3b7b6c1g5c8a6e2e3d7d6f1d3b8d7b2b4c7c5.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2e8g8a2a3b4c3c2c3b7b6c1g5c8b7f2f3h7h6g5h4d7d5e2e3b8d7.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2e8g8a2a3b4c3c2c3b7b6c1g5c8b7f2f3h7h6g5h4d7d5e2e3b8d7.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2e8g8a2a3b4c3c2c3b7b6c1g5c8b7g1f3d7d6e2e3b8d7c3c2d8e8.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2e8g8a2a3b4c3c2c3b7b6c1g5h7h6g5h4c8b7e2e3d7d6f2f3b8d7.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2e8g8a2a3b4c3c2c3b7b6g1f3c8b7e2e3d7d6b2b3b8d7c1b2d8e7.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2e8g8a2a3b4c3c2c3b7b6g1f3c8b7e2e3d7d6f1e2b8d7e1g1f6e4.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2e8g8c1g5h7h6g5h4c7c5d4c5b8a6e2e3a6c5g1e2d7d5e1c1c8d7.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2e8g8g1f3c7c5d4c5b8a6a2a3b4c5b2b4c5e7c1b2b7b6e2e3c8b7.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2e8g8g1f3c7c5d4c5b8a6c1d2a6c5e2e3b7b6f1e2c8b7e1g1c5e4.
d2d4g8f6c2c4e7e6b1c3f8b4d1c2e8g8g1f3c7c5d4c5b8a6g2g3a6c5f1g2c5e4c1d2e4d2f3d2d7d5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3b7b6a2a3b4c3b2c3c8b7f2f3b8c6e3e4d7d6f1d3c6a5g1e2d8d7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3b7b6f1d3c8b7g1f3e8g8e1g1c7c5c1d2c5d4e3d4d7d5c4d5f6d5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3b7b6f1d3c8b7g1f3f6e4d1c2f7f5e1g1b4c3b2c3e8g8f3e1d7d6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3b7b6f1d3c8b7g1f3f6e4e1g1b4c3b2c3e4c3d1c2b7f3g2f3d8g5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3b7b6g1e2c8a6a2a3b4e7e2f4d7d5c4d5a6f1e1f1e6d5g2g4c7c6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3b7b6g1e2c8a6a2a3b4e7e2g3d7d5c4d5a6f1g3f1e6d5f1g3d8d7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3b7b6g1e2c8a6e2g3e8g8e3e4d7d6c1d2c7c5a2a3b4a5d4d5e6d5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3b7b6g1e2c8a6e2g3e8g8f1d3c7c5e1g1c5d4e3d4d7d5c4d5a6d3.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3b7b6g1e2c8b7a2a3b4c3e2c3e8g8f1d3c7c5d4d5b6b5e1g1b5c4.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3b7b6g1e2e8g8a2a3b4c3e2c3d7d5c4d5e6d5b2b4c7c5b4c5b6c5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5a2a3b4c3b2c3b7b6f1d3c8b7f2f3b8c6g1e2e8g8e1g1c6a5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5a2a3b4c3b2c3b8c6f1d3e8g8g1e2b7b6e3e4f6e8c1e3d7d6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3b7b6g1f3c8b7e1g1e8g8c1d2d7d6d1c2b8d7a2a3b4c3.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3b7b6g1f3c8b7e1g1e8g8c3a4c5d4e3d4d8c7a2a3b4e7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3b8c6g1e2c5d4e3d4d7d5c4d5f6d5e1g1b4d6c3e4d6e7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3b8c6g1e2c5d4e3d4d7d5c4d5f6d5e1g1b4d6c3e4d6e7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3b8c6g1e2c5d4e3d4d7d5c4d5f6d5e1g1e8g8d3b1b4e7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3b8c6g1e2c5d4e3d4d7d5c4d5f6d5e1g1e8g8d3c2b4d6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3b8c6g1f3b4c3b2c3d7d6e1g1e6e5d1c2e8g8f3g5h7h6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3b8c6g1f3b4c3b2c3d7d6e1g1e8g8f3d2e6e5d2e4b7b6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3b8c6g1f3d7d5e1g1e8g8a2a3b4c3b2c3d5c4d3c4d8c7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3b8c6g1f3d7d5e1g1e8g8a2a3b4c3b2c3d5c4d3c4d8c7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3b8c6g1f3d7d5e1g1e8g8a2a3b4c3b2c3d5c4d3c4d8c7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3b8c6g1f3e8g8e1g1d7d5a2a3b4c3b2c3d5c4d3c4d8c7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3c5d4e3d4d7d5c4d5f6d5g1e2e8g8e1g1b8c6c3d5e6d5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3d7d5g1f3b8c6e1g1e8g8a2a3c5d4e3d4d5c4d3c4b4e7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3d7d5g1f3d5c4d3c4a7a6a2a3b4a5e1g1b7b5c4e2c5d4.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3d7d5g1f3e8g8e1g1b7b6c4d5e6d5c1d2c8g4a2a3b4c3.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3d7d5g1f3e8g8e1g1b7b6c4d5e6d5f3e5f8e8c1d2c8a6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3d7d5g1f3e8g8e1g1b8c6a2a3b4c3b2c3d5c4d3c4d8c7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3d7d5g1f3e8g8e1g1b8c6a2a3b4c3b2c3d5c4d3c4d8c7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3d7d5g1f3e8g8e1g1b8c6a2a3b4c3b2c3d5c4d3c4d8c7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3d7d5g1f3e8g8e1g1b8c6a2a3b4c3b2c3d5c4d3c4d8c7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3d7d5g1f3e8g8e1g1b8c6a2a3b4c3b2c3d5c4d3c4d8c7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3d7d5g1f3e8g8e1g1c5d4e3d4d5c4d3c4b7b6c1g5c8b7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3e8g8a2a3b4c3b2c3b7b6e3e4c8b7c1g5h7h6h2h4d7d6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3e8g8a2a3b4c3b2c3b7b6g1e2c8b7e1g1d7d6d1c2d6d5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3e8g8a2a3b4c3b2c3b8c6g1e2b7b6e1g1c8a6e3e4f6e8.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3e8g8g1f3b7b6e1g1c8b7a2a3b4c3b2c3b7e4d3e2b8c6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3e8g8g1f3b7b6e1g1c8b7c1d2c5d4e3d4d7d5c4d5b4c3.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3e8g8g1f3d7d5e1g1b8c6a2a3b4c3b2c3b7b6c4d5e6d5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3e8g8g1f3d7d5e1g1b8c6a2a3b4c3b2c3d5c4d3c4d8c7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3e8g8g1f3d7d5e1g1b8c6a2a3b4c3b2c3d5c4d3c4d8c7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3e8g8g1f3d7d5e1g1b8c6a2a3b4c3b2c3d5c4d3c4d8c7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3e8g8g1f3d7d5e1g1b8d7a2a3d5c4d3c4c5d4e3d4b4e7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5f1d3e8g8g1f3d7d5e1g1d5c4d3c4b7b6d1e2c8b7f1d1c5d4.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5g1e2c5d4e3d4d7d5c4c5f6e4c1d2e4d2d1d2b7b6a2a3b4c3.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5g1e2c5d4e3d4e8g8a2a3b4e7d4d5e6d5c4d5f8e8d5d6e7f8.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5g1e2c5d4e3d4e8g8a2a3b4e7e2f4d7d5c4d5f6d5c3d5e6d5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5g1e2d7d5a2a3b4c3e2c3c5d4e3d4d5c4f1c4b8c6c1e3e8g8.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5g1f3d7d5a2a3b4c3b2c3e8g8c4d5e6d5f1d3b8c6e1g1c8g4.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5g1f3d7d5f1e2e8g8e1g1b8c6c4d5e6d5d4c5b4c5a2a3a7a6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5g1f3e8g8f1d3b7b6d4d5e6d5c4d5f6d5d3h7g8h7d1d5b4c3.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5g1f3e8g8f1d3d7d5e1g1b8c6a2a3b4c3b2c3d5c4d3c4d8c7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3c7c5g1f3e8g8f1d3d7d5e1g1d5c4d3c4b8d7c1d2c5d4e3d4d7b6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3d7d5a2a3b4d6g1f3e8g8c4c5d6e7b2b4f6e4c1b2b8d7f1d3f7f5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3d7d5a2a3b4e7g1f3e8g8b2b4b8d7c1b2c7c6f1d3d5c4d3c4e7d6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3d7d5a2a3b4e7g1f3e8g8f1d3c7c5e1g1b7b6d1e2b8c6d4c5b6c5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3d7d5c1d2e8g8g1f3b8c6f1d3d5c4d3c4a7a6e1g1b7b5c4d3c8b7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3d7d5f1d3e8g8g1f3c7c5e1g1b8d7a2a3b4a5d1c2c5d4e3d4d5c4.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3d7d5f1d3e8g8g1f3d5c4d3c4c7c5e1g1c5d4e3d4b8c6a2a3b4c3.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3d7d5g1f3e8g8f1d3c7c5e1g1b8c6a2a3b4c3b2c3d8c7d1c2c6a5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3d7d5g1f3e8g8f1d3c7c5e1g1d5c4d3c4c8d7a2a3b4c3b2c3d7c6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8a2a3b4c3b2c3d7d6g1e2e6e5e2g3f8e8f2f3c7c5e3e4e5d4.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8a2a3b4c3b2c3f8e8g1e2e6e5e2g3d7d6f1e2b8d7e1g1c7c5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3b7b6g1e2d7d5e1g1d5c4d3c4c8b7f2f3c7c5a2a3c5d4.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3c7c5a2a3b4c3b2c3b8c6g1e2b7b6e3e4f6e8e1g1c8a6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3c7c5d4d5b7b5d5e6f7e6c4b5c8b7g1f3d7d5e1g1b8d7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3c7c5g1e2d7d5e1g1d5c4d3c4b8c6a2a3b4c3b2c3d8c7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3c7c5g1f3b7b6e1g1c8b7c3a4c5d4a2a3b4e7e3d4d8c7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3c7c5g1f3d7d5e1g1b7b6c4d5e6d5d4c5b6c5c3e2b8c6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3c7c5g1f3d7d5e1g1b8c6a2a3b4a5c4d5e6d5d4c5a5c3.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3c7c5g1f3d7d5e1g1b8c6a2a3b4c3b2c3d5c4d3c4d8c7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3c7c5g1f3d7d5e1g1b8c6a2a3b4c3b2c3d8c7c4d5e6d5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3c7c5g1f3d7d5e1g1b8c6a2a3b4c3b2c3d8c7c4d5e6d5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3c7c5g1f3d7d5e1g1b8c6a2a3d5c4d3c4b4a5d1d3a7a6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3c7c5g1f3d7d5e1g1b8d7a2a3b4a5c4d5e6d5d1e2f8e8.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3c7c5g1f3d7d5e1g1d5c4d3c4b8c6a2a3b4a5c4a2a5b6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3c7c5g1f3d7d5e1g1d5c4d3c4b8c6a2a3b4a5c4a2a7a6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3c7c5g1f3d7d5e1g1d5c4d3c4b8c6a2a3b4a5c4a2a7a6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3c7c5g1f3d7d5e1g1d5c4d3c4b8c6a2a3b4a5c4d3c5d4.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3c7c5g1f3d7d5e1g1d5c4d3c4b8d7c4b3b7b6a2a3c5d4.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3c7c5g1f3d7d5e1g1d5c4d3c4c5d4e3d4b7b6d1e2c8b7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3c7c5g1f3d7d5e1g1d5c4d3c4d8e7a2a3b4a5d1c2c8d7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5a2a3b4c3b2c3d5c4d3c4c7c5g1e2d8c7c4d3b7b6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5a2a3d5c4d3c4b4d6d1c2b8d7g1f3a7a6c4a2c7c5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5a2a3d5c4d3c4b4d6d1c2b8d7g1f3c7c5d4c5d6c5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1e2d5c4d3c4e6e5e1g1e5d4e3d4b8c6h2h3c8f5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3b7b6e1g1c7c5d1e2b8d7c4d5e6d5a2a3b4a5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3b7b6e1g1c8b7a2a3b4c3b2c3d5c4d3c4c7c5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3b7b6e1g1c8b7a2a3b4d6b2b4d5c4d3c4b8d7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3b7b6e1g1c8b7a2a3b4d6d1e2c7c5d4c5b6c5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3b7b6e1g1c8b7c1d2d5c4d3c4b8d7d1e2c7c5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3b7b6e1g1c8b7c4d5e6d5a2a3b4d6b2b4a7a6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3b7b6e1g1c8b7c4d5e6d5a2a3b4d6b2b4a7a6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3b7b6e1g1c8b7c4d5e6d5c1d2b8d7d1c2c7c5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3b7b6e1g1c8b7c4d5e6d5f3e5b4d6f2f4c7c5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3b7b6e1g1c8b7d1e2b8d7a2a3b4c3b2c3c7c5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3c7c5e1g1b7b6c4d5e6d5d4c5b6c5c3a4b8d7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3c7c5e1g1b8c6a2a3b4c3b2c3b7b6c4d5e6d5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3c7c5e1g1b8c6a2a3b4c3b2c3b7b6c4d5e6d5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3c7c5e1g1b8c6a2a3b4c3b2c3b7b6c4d5e6d5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3c7c5e1g1b8c6a2a3b4c3b2c3b7b6f3e5c8b7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3c7c5e1g1b8c6a2a3b4c3b2c3d8c7c4d5e6d5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3c7c5e1g1b8c6a2a3b4c3b2c3d8c7c4d5e6d5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3c7c5e1g1b8c6a2a3b4c3b2c3d8c7c4d5e6d5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3c7c5e1g1b8c6a2a3d5c4d3c4b4a5d1d3a7a6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3c7c5e1g1b8d7a2a3b4a5d1c2c5d4e3d4d5c4.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3c7c5e1g1b8d7c4d5e6d5a2a3b4c3b2c3f8e8.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3c7c5e1g1b8d7d1e2a7a6a2a3b4a5a1b1d5c4.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3c7c5e1g1b8d7d1e2a7a6a2a3c5d4e3d4d5c4.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3c7c5e1g1c5d4e3d4d5c4d3c4b7b6f1e1c8b7.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3c7c5e1g1d5c4d3c4b8c6a2a3b4a5d1d3a7a6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3c7c5e1g1d5c4d3c4b8d7a2a3c5d4e3d4b4c3.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3c7c5e1g1d5c4d3c4b8d7d1e2a7a6a2a3c5d4.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d5g1f3d5c4d3c4c7c5e1g1b8c6a2a3b4a5d1d3a7a6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d6g1e2e6e5e1g1b4c3e2c3f8e8b2b3e5e4d3c2c8g4.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8f1d3d7d6g1e2e6e5e1g1b8c6c3d5e5d4e3d4h7h6d5b4c6b4.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8g1e2d7d5a2a3b4e7c4d5e6d5b2b4b7b6e2f4c7c6f1d3e7d6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8g1e2d7d5a2a3b4e7c4d5e6d5b2b4b8d7e2g3f8e8f1d3c7c6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8g1e2d7d5a2a3b4e7c4d5e6d5e2g3c7c5d4c5e7c5b2b4d5d4.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8g1e2d7d5a2a3b4e7c4d5e6d5e2g3c7c5f1d3b8c6e1g1f8e8.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8g1e2d7d5a2a3b4e7c4d5e6d5e2g3c8e6f1d3b8d7e1g1c7c6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8g1e2d7d5a2a3b4e7c4d5e6d5e2g3f8e8b2b4c7c6f1d3b7b5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8g1e2d7d5a2a3b4e7c4d5e6d5e2g3f8e8f1d3b8d7e1g1a7a6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8g1e2d7d5a2a3b4e7c4d5e6d5g2g3b8d7f1g2d7b6e1g1f8e8.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8g1e2d7d5a2a3b4e7c4d5e6d5g2g3b8d7f1g2d7b6e1g1f8e8.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8g1e2d7d5a2a3b4e7c4d5f6d5d1c2b8d7b2b4c7c6c1d2d5b6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8g1e2d7d5a2a3b4e7c4d5f6d5d1c2b8d7c1d2c7c5c3d5e6d5.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8g1e2d7d5a2a3b4e7c4d5f6d5d1c2b8d7e2g3c7c5f1d3d5f6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8g1e2d7d5a2a3b4e7e2g3c7c5d4c5e7c5b2b4c5e7c1b2d5c4.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8g1e2f8e8g2g3d7d5f1g2d5c4e1g1c7c6d1c2b8d7c3e4d7b6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8g1f3b7b6f1e2c8b7e1g1d7d5c4d5e6d5c1d2b4d6a1c1a7a6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8g1f3c7c5f1e2d7d5e1g1c5d4e3d4b8c6c1g5b4e7a1c1b7b6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8g1f3d7d5a2a3b4c3b2c3b7b6c4d5e6d5f1d3c7c5e1g1b8c6.
d2d4g8f6c2c4e7e6b1c3f8b4e2e3e8g8g1f3d7d5f1e2b7b6e1g1c8b7a2a3b4d6b2b4d5c4e2c4a7a5.
d2d4g8f6c2c4e7e6b1c3f8b4f2f3d7d5a2a3b4c3b2c3c7c5c4d5f6d5d4c5d8a5e2e4d5e7c1e3e8g8.
d2d4g8f6c2c4e7e6b1c3f8b4f2f3d7d5a2a3b4c3b2c3c7c5c4d5f6d5d4c5d8a5e2e4d5e7c1e3e8g8.
d2d4g8f6c2c4e7e6b1c3f8b4f2f3d7d5a2a3b4c3b2c3e8g8c4d5e6d5e2e3f6h5g1e2b7b6g2g3c8a6.
d2d4g8f6c2c4e7e6b1c3f8b4f2f3d7d5a2a3b4e7e2e4d5e4f3e4e6e5d4d5e7c5c1g5a7a5g1f3d8e7.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3b7b6c1g5h7h6g5h4g7g5h4g3f6e4d1c2c8b7e2e3d7d6f1d3b4c3.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3c7c5e2e3b8c6f1d3b4c3b2c3d7d6e3e4e6e5d4d5c6e7f3h4h7h6.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3c7c5e2e3d7d5a2a3b4c3b2c3e8g8c1b2b8c6a1c1f8e8f1d3d5c4.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3c7c5e2e3d7d5a2a3b4c3b2c3e8g8f1d3b8d7e1g1b7b6c4d5e6d5.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3c7c5e2e3d7d5f1d3e8g8e1g1b8c6a2a3b4c3b2c3d5c4d3c4d8c7.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3c7c5e2e3e8g8f1e2b7b6e1g1c8b7c3a4c5d4e3d4b4e7a2a3f6e4.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3c7c5e2e3e8g8f1e2d7d5e1g1b8c6c4d5c5d4d5c6d4c3d1b3d8e7.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3c7c5g2g3b7b6f1g2c8b7e1g1c5d4d1d4b8c6d4d3e8g8f1d1a8c8.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3c7c5g2g3b7b6f1g2c8b7e1g1c5d4d1d4b8c6d4d3e8g8f1d1a8c8.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3c7c5g2g3b8c6f1g2d7d5c4d5f6d5c1d2c5d4f3d4c6d4c3d5b4d2.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3c7c5g2g3b8c6f1g2f6e4c1d2b4c3b2c3e8g8e1g1c6a5d4c5d8c7.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3c7c5g2g3b8c6f1g2f6e4c1d2b4c3b2c3e8g8e1g1f7f5d2e3e4c3.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3c7c5g2g3c5d4f3d4e8g8f1g2d7d5c4d5f6d5d1b3b8a6e1g1d5c3.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3c7c5g2g3c5d4f3d4e8g8f1g2d7d5d1b3b4c3b2c3b8c6c4d5c6a5.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3c7c5g2g3c5d4f3d4e8g8f1g2d7d5e1g1d5c4d1a4d8e7d4c2b4c5.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3c7c5g2g3d7d5c4d5f6d5c1d2c5d4c3d5b4d2d1d2d8d5d2d4d5d4.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3c7c5g2g3f6e4d1d3d8a5d3e4b4c3c1d2c3d2f3d2a5b6d4c5b6b2.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3d7d6d1b3a7a5g2g3b8c6f1g2f6e4e1g1b4c3b2c3e8g8f3e1f7f5.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3e8g8c1g5c7c5e2e3c5d4e3d4h7h6g5h4d7d5a1c1d5c4f1c4b8c6.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3e8g8c1g5d7d6e2e3b8d7d1c2b7b6f1d3b4c3b2c3h7h6g5h4c8b7.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3e8g8d1b3c7c5d4c5b8a6c1d2d8e7e2e3a6c5b3c2b7b6f1e2c8b7.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3f6e4d1c2d7d5e2e3c7c5f1d3e4f6c4d5e6d5d4c5b4c5e1g1b8c6.
d2d4g8f6c2c4e7e6b1c3f8b4g1f3f6e4d1c2f7f5g2g3b8c6f1g2e8g8e1g1b4c3b2c3c6a5c4c5d7d6.
d2d4g8f6c2c4e7e6g1f3b7b6a2a3c7c5d4d5c8a6d1c2e6d5c4d5g7g6b1c3f8g7g2g3e8g8f1g2d7d6.
d2d4g8f6c2c4e7e6g1f3b7b6a2a3c7c5d4d5c8a6d1c2e6d5c4d5g7g6b1c3f8g7g2g3e8g8f1g2d7d6.
d2d4g8f6c2c4e7e6g1f3b7b6a2a3c8a6d1c2a6b7b1c3c7c5d4c5b6c5c1g5h7h6g5h4f8e7e2e3e8g8.
d2d4g8f6c2c4e7e6g1f3b7b6a2a3c8a6d1c2a6b7b1c3c7c5e2e3f8e7f1d3c5d4e3d4d8c8e1g1b7f3.
d2d4g8f6c2c4e7e6g1f3b7b6a2a3c8a6d1c2d7d5c4d5e6d5b1c3c7c6g2g3f8d6f1g2e8g8e1g1f8e8.
d2d4g8f6c2c4e7e6g1f3b7b6a2a3c8a6d1c2d7d5e2e3f8e7b2b4e8g8b1d2c7c5b4b5a6b7c1b2b8d7.
d2d4g8f6c2c4e7e6g1f3b7b6a2a3c8a6e2e3c7c5b1c3c5d4f3d4a6b7d4b5d7d6f1e2a7a6e2f3d8d7.
d2d4g8f6c2c4e7e6g1f3b7b6a2a3c8a6e2e3d7d5b1d2f8e7b2b4e8g8c1b2c7c5d4c5b6c5b4b5a6b7.
d2d4g8f6c2c4e7e6g1f3b7b6a2a3c8b7b1c3d7d5c4d5e6d5g2g3f8d6f1g2e8g8e1g1f8e8c1g5b8d7.
d2d4g8f6c2c4e7e6g1f3b7b6a2a3c8b7b1c3d7d5c4d5f6d5c1d2b8d7d1c2c7c5c3d5e6d5d4c5b6c5.
d2d4g8f6c2c4e7e6g1f3b7b6a2a3c8b7b1c3d7d5c4d5f6d5c1d2f8e7d1c2e8g8e2e4d5c3d2c3b8d7.
d2d4g8f6c2c4e7e6g1f3b7b6a2a3c8b7b1c3d7d5c4d5f6d5d1c2c7c5e2e4d5c3b2c3b8d7c1f4c5d4.
d2d4g8f6c2c4e7e6g1f3b7b6a2a3c8b7b1c3d7d5e2e3b8d7c4d5e6d5f1e2f8d6b2b4e8g8e1g1a7a6.
d2d4g8f6c2c4e7e6g1f3b7b6a2a3c8b7b1c3f8e7d4d5e6d5c4d5e8g8g2g3f8e8f1g2e7f8e1g1c7c6.
d2d4g8f6c2c4e7e6g1f3b7b6a2a3c8b7b1c3g7g6c1f4f8g7e2e3e8g8f1e2d7d6e1g1b8d7h2h3f6e4.
d2d4g8f6c2c4e7e6g1f3b7b6a2a3c8b7b1c3g7g6c1g5f8g7e2e3h7h6g5h4d7d6d4d5e8g8f1e2g6g5.
d2d4g8f6c2c4e7e6g1f3b7b6a2a3f8e7b1c3d7d5c4d5e6d5c1f4e8g8e2e3c7c5f3e5c8b7f1e2b8c6.
d2d4g8f6c2c4e7e6g1f3b7b6a2a3f8e7b1c3d7d5c4d5e6d5g2g3e8g8f1g2c8b7e1g1c7c5c1f4b8c6.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7a2a3b7f3g2f3f8e7f3f4d7d5f4f5e6f5f1g2e8g8c4d5e7d6.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7a2a3d7d5c4d5e6d5g2g3f8d6f1g2e8g8e1g1c7c6f3e5d8e7.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7a2a3d7d5c4d5e6d5g2g3f8e7d1a4c7c6f1g2e8g8e1g1b8d7.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7a2a3d7d5c4d5f6d5d1a4b8d7c3d5e6d5c1f4c7c6g2g3f8e7.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7a2a3d7d5c4d5f6d5d1c2b8d7c3d5e6d5c1g5f7f6g5f4c7c5.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7a2a3d7d5c4d5f6d5d1c2c7c5d4c5f8c5c1g5d8c8a1c1h7h6.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7a2a3d7d5c4d5f6d5d1c2d5c3b2c3c7c5e2e4b8c6c1b2a8c8.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7a2a3d7d5c4d5f6d5d1c2d5c3b2c3f8e7e2e3b8d7f1d3c7c5.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7a2a3d7d5c4d5f6d5d1c2d5c3c2c3h7h6e2e3f8d6f1b5c7c6.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7a2a3d7d5c4d5f6d5e2e3b8d7f1d3c7c5e3e4d5f6d4d5e6d5.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7a2a3d7d5c4d5f6d5e2e3f8e7f1d3d5c3b2c3c7c5e1g1e8g8.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7a2a3d7d5c4d5f6d5e2e3g7g6f1b5c7c6b5d3f8g7e3e4d5c3.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7c1f4f8b4d1b3a7a5e2e3f6e4f1d3e4c3b2c3b4e7e3e4d7d6.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7c1g5f8b4a1c1h7h6g5f6d8f6e2e3e8g8f1e2d7d6e1g1b4c3.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7c1g5f8b4e2e3h7h6g5h4g7g5h4g3f6e4d1c2b4c3b2c3d7d6.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7c1g5h7h6g5h4f8e7d1c2c7c5d4c5b6c5e2e3e8g8f1e2d7d6.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7c1g5h7h6g5h4f8e7d1c2c7c5d4c5b6c5e2e3e8g8f1e2d7d6.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7c1g5h7h6g5h4f8e7e2e3f6e4h4e7d8e7c3e4b7e4f1e2e7b4.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7c1g5h7h6g5h4f8e7e2e3f6e4h4e7d8e7c3e4b7e4f1e2e8g8.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7c1g5h7h6g5h4f8e7e2e3f6e4h4e7d8e7c3e4b7e4f1e2e8g8.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7e2e3d7d5c4d5e6d5f1b5c7c6b5d3f8e7e1g1e8g8b2b3b8d7.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7e2e3f8e7f1d3c7c5e1g1c5d4e3d4d7d5c4d5f6d5d3b5b7c6.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3c8b7e2e3f8e7f1d3d7d5e1g1e8g8d1e2b8d7b2b3a7a6c1b2e7d6.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3f8b4c1d2c8b7e2e3e8g8f1d3d7d5e1g1c7c5c4d5e6d5d4c5b6c5.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3f8b4c1g5c8b7e2e3h7h6g5h4b4c3b2c3d7d6f3d2g7g5h4g3d8e7.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3f8b4c1g5c8b7e2e3h7h6g5h4g7g5h4g3f6e4d1c2b4c3b2c3d7d6.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3f8b4c1g5c8b7e2e3h7h6g5h4g7g5h4g3f6e4d1c2b4c3b2c3d7d6.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3f8b4c1g5c8b7e2e3h7h6g5h4g7g5h4g3f6e4d1c2b4c3b2c3d7d6.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3f8b4d1b3d8e7c1g5c8b7e2e3a7a5a2a3b4c3b3c3f6e4g5e7e4c3.
d2d4g8f6c2c4e7e6g1f3b7b6b1c3f8b4e2e3f6e4d1c2c8b7f1d3f7f5e1g1b4c3b2c3e8g8f3e1c7c5.
d2d4g8f6c2c4e7e6g1f3b7b6c1g5h7h6g5h4c8b7e2e3c7c5b1c3f8e7f1e2c5d4f3d4e8g8e1g1b8c6.
d2d4g8f6c2c4e7e6g1f3b7b6e2e3c8b7a2a3d7d5b2b4d5c4f1c4f8e7b1d2e8g8a1b1b8d7e1g1a8b8.
d2d4g8f6c2c4e7e6g1f3b7b6e2e3c8b7f1d3d7d5e1g1b8d7b2b3f8e7c1b2e8g8b1c3c7c5d1e2a8c8.
d2d4g8f6c2c4e7e6g1f3b7b6e2e3c8b7f1d3f8b4b1d2c7c5d4c5b4c5e1g1b8c6a2a3d8c7b2b3c6e5.
d2d4g8f6c2c4e7e6g1f3b7b6e2e3c8b7f1d3f8b4b1d2e8g8a2a3b4d2d1d2c7c5b2b4d7d6c1b2b8d7.
d2d4g8f6c2c4e7e6g1f3b7b6e2e3c8b7f1d3f8e7b1c3d7d5d1a4c7c6c4d5e6d5e1g1e8g8a4c2c6c5.
d2d4g8f6c2c4e7e6g1f3b7b6e2e3c8b7f1d3f8e7b1c3d7d5e1g1e8g8d1e2c7c5d4c5b6c5f1d1d8b6.
d2d4g8f6c2c4e7e6g1f3b7b6e2e3c8b7f1d3f8e7e1g1e8g8b1c3d7d5d1e2b8d7b2b3a7a6c1b2e7d6.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b1d2a6b7f1g2c7c5e2e4c5d4e1g1d7d6f3d4b8d7f1e1e6e5.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b1d2a6b7f1g2f8e7e1g1e8g8d1c2b8a6a2a3c7c5b2b3d7d5.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b1d2a6b7f1g2f8e7e1g1e8g8d1c2d7d5c4d5e6d5f3e5c7c5.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b1d2a6b7f1g2f8e7e2e4f6e4f3e5e7b4d1e2d7d5c4d5d8d5.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b1d2c7c5f1g2b8c6d4c5f8c5e1g1e8g8a2a3a6b7b2b4c5e7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b1d2c7c6f1g2d7d5e1g1f8e7f3e5e8g8b2b3a6b7c1b2b8a6.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b1d2f8b4d1c2a6b7f1g2b7e4c2b3b4d2c1d2e8g8e1g1d7d6.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b1d2f8b4d1c2a6b7f1g2b7e4c2d1b4d2c1d2e8g8e1g1d7d6.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3a6b7f1g2f8b4c1d2a7a5e1g1e8g8b1c3f6e4c3e4b7e4.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3d7d5f1g2d5c4f3e5f8b4e1f1f6d7e5c4c7c6c1b2b6b5.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3d7d5f1g2d5c4f3e5f8b4e1f1f6d7e5c4c7c6c1b2e8g8.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4d2d1d2d7d5c4d5e6d5d2e3d8e7e3e7e8e7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7b1c3d7d5c4d5f6d5c3d5e6d5f1g2b8d7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7b1c3d7d5c4d5f6d5c3d5e6d5f1g2e8g8.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7b1c3d7d5c4d5f6d5f1g2e8g8c3d5e6d5.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7b1c3e8g8e2e4d7d5c4d5a6f1e1f1e6d5.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7b1c3e8g8e2e4d7d5c4d5a6f1e1f1e6d5.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7b1c3e8g8f1g2c7c6e2e4d7d5d1e2b8d7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2a6b7b1c3d7d5c4d5e6d5e1g1e8g8.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2a6b7b1c3e8g8e1g1b8a6f1e1c7c5.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2c7c6d2c3d7d5b1d2a6b7f3e5e8g8.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2c7c6d2c3d7d5b1d2b8d7e1g1e8g8.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2c7c6d2c3d7d5f3e5a6b7b1d2b8d7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2c7c6d2c3d7d5f3e5e8g8e1g1a6b7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2c7c6d2c3d7d5f3e5f6d7e5d7b8d7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2c7c6d2c3d7d5f3e5f6d7e5d7b8d7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2c7c6d2c3d7d5f3e5f6d7e5d7b8d7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2c7c6d2c3d7d5f3e5f6d7e5d7b8d7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2c7c6d2c3d7d5f3e5f6d7e5d7b8d7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2c7c6d2c3d7d5f3e5f6e4e1g1e4c3.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2c7c6d2c3e8g8b1d2d7d5f3e5a6b7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2c7c6e1g1d7d5f3e5f6d7e5d7b8d7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2d7d5f3e5a6b7e1g1b8d7b1c3c7c5.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2d7d5f3e5c7c6d2c3f6e4e1g1e4c3.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2d7d5f3e5e8g8e1g1a6b7b1c3b8d7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2e8g8e1g1d7d5c4d5f6d5b1c3b8d7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2e8g8e1g1d7d5f3e5c7c6d2c3f6d7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2e8g8e1g1d7d5f3e5c7c6d2c3f6d7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6d1a4f8e7b1c3e8g8f1g2a6b7a4c2d7d5c4d5e6d5e1g1b8a6.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6d1a4f8e7f1g2e8g8b1c3c7c6f3e5d8e8e1g1d7d5f1e1b6b5.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6d1b3b8c6b1d2f8e7f1g2e8g8e1g1d7d5b3a4a6b7f1d1d8d7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8a6d1b3d7d5c4d5e6d5b1c3f8e7f1g2e8g8f3e5a6b7e1g1c7c6.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8b7f1g2f8b4c1d2a7a5e1g1e8g8d2g5b4e7d1c2h7h6g5f6e7f6.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8b7f1g2f8b4c1d2b4d2d1d2d7d6e1g1e8g8b1c3f6e4c3e4b7e4.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8b7f1g2f8b4c1d2b4e7b1c3f6e4e1g1e8g8d4d5e4d2d1d2e7f6.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8b7f1g2f8e7b1c3f6e4c1d2d7d6d4d5e4d2d1d2e6e5h2h4b8d7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8b7f1g2f8e7b1c3f6e4c1d2e7f6e1g1e8g8d1c2e4d2c2d2d7d6.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8b7f1g2f8e7b1c3f6e4c1d2e8g8d4d5e4c3d2c3e7f6a1c1c7c6.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8b7f1g2f8e7b1c3f6e4c1d2f7f5e1g1e8g8d1c2e4c3d2c3b7e4.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8b7f1g2f8e7e1g1e8g8b1c3f6e4c3e4b7e4d4d5e7f6f3e1e4g2.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8b7f1g2f8e7e1g1e8g8b1c3f6e4c3e4b7e4f3e1e4g2e1g2d7d5.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8b7f1g2f8e7e1g1e8g8b1c3f6e4d1c2e4c3c2c3b7e4b2b3c7c5.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8b7f1g2f8e7e1g1e8g8b1c3f6e4d1c2e4c3c2c3c7c5c1e3e7f6.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8b7f1g2f8e7e1g1e8g8b1c3f6e4d1c2e4c3c2c3c7c5f1d1d7d6.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8b7f1g2f8e7e1g1e8g8b1c3f6e4d1c2e4c3c2c3c7c5f1d1e7f6.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8b7f1g2f8e7e1g1e8g8b1c3f6e4d1c2e4c3c2c3d7d6f1d1b8d7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8b7f1g2f8e7e1g1e8g8b1c3f6e4d1c2e4c3c2c3f7f5b2b3e7f6.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8b7f1g2f8e7e1g1e8g8b1c3f6e4d1c2e4c3c2c3f7f5b2b3e7f6.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8b7f1g2f8e7e1g1e8g8b1c3f6e4d1c2e4c3c2c3f7f5b2b3e7f6.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8b7f1g2f8e7e1g1e8g8b2b3d7d5f3e5c7c5d4c5b6c5c4d5e6d5.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3c8b7f1g2f8e7e1g1e8g8d4d5e6d5f3h4c7c6c4d5f6d5h4f5d5c7.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3f8b4c1d2b4d2d1d2c8a6b1a3c7c5f1g2b8c6e1g1e8g8f1d1a8c8.
d2d4g8f6c2c4e7e6g1f3b7b6g2g3f8b4c1d2b4d2d1d2c8a6d2c2c7c5f1g2b8c6d4c5b6c5e1g1e8g8.
d2d4g8f6c2c4e7e6g1f3c7c5b1c3c5d4f3d4f8b4d1b3b8a6e2e3f6e4f1e2d8a5e1g1a6c5b3c2b4c3.
d2d4g8f6c2c4e7e6g1f3c7c5d4d5d7d6b1c3g7g6e2e4f8g7h2h3e8g8f1d3e6d5c4d5a7a6a2a4f6h5.
d2d4g8f6c2c4e7e6g1f3c7c5d4d5e6d5c4d5d7d6b1c3g7g6e2e4f8g7f1e2e8g8e1g1f8e8f3d2b8d7.
d2d4g8f6c2c4e7e6g1f3c7c5d4d5e6d5c4d5d7d6b1c3g7g6f3d2b8d7e2e4f8g7f1e2e8g8e1g1a7a6.
d2d4g8f6c2c4e7e6g1f3c7c5d4d5e6d5c4d5d7d6b1c3g7g6f3d2b8d7e2e4f8g7f1e2e8g8e1g1f8e8.
d2d4g8f6c2c4e7e6g1f3c7c5d4d5e6d5c4d5g7g6b1c3f8g7c1g5e8g8e2e3f8e8f3d2d7d6f1e2a7a6.
d2d4g8f6c2c4e7e6g1f3c7c5d4d5e6d5c4d5g7g6b1c3f8g7e2e4e8g8f1e2f8e8f3d2d7d6e1g1b8d7.
d2d4g8f6c2c4e7e6g1f3c7c5e2e3d7d5c4d5e6d5b1c3b8c6f1e2a7a6e1g1f8d6d4c5d6c5b2b3e8g8.
d2d4g8f6c2c4e7e6g1f3c7c5g2g3c5d4f3d4d8a5b1c3f8b4d1d3f6e4d4b3a5f5d3e3e4c3b2c3b4e7.
d2d4g8f6c2c4e7e6g1f3c7c5g2g3c5d4f3d4f8b4c1d2d8b6d2b4b6b4b1c3b4b2d4b5b2b4b5c7e8d8.
d2d4g8f6c2c4e7e6g1f3c7c6b1c3d7d5e2e3b8d7f1d3d5c4d3c4b7b5c4d3a7a6e3e4c6c5e4e5c5d4.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3b8d7c1g5h7h6g5h4d5c4e2e4f8e7d1e2d7b6h4g3e8g8e1c1c8d7.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3b8d7d1c2f8e7c4d5e6d5c1f4c7c6h2h3d7f8e2e3f8g6f4h2e8g8.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3c7c5c4d5c5d4d1d4e6d5c1g5f8e7e2e3b8c6d4d2e8g8f1e2c8e6.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3c7c5c4d5f6d5e2e3b8c6f1c4d5c3b2c3f8e7e1g1e8g8e3e4b7b6.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3c7c5c4d5f6d5e2e3b8c6f1d3c5d4e3d4g7g6c1g5d8a5e1g1f8g7.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3c7c5c4d5f6d5e2e3b8c6f1d3d5c3b2c3f8e7d1c2g7g6h2h4h7h5.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3c7c5c4d5f6d5e2e4d5c3b2c3c5d4c3d4b8c6f1c4b7b5c4d3f8b4.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3c7c5c4d5f6d5e2e4d5c3b2c3c5d4c3d4b8c6f1c4b7b5c4e2f8b4.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3c7c5c4d5f6d5g2g3c5d4c3d5d8d5d1d4d5b5e2e4b5b4d4b4f8b4.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3c7c5e2e3b8c6a2a3f6e4d1c2e4c3b2c3f8e7c1b2e8g8f1d3h7h6.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3c7c6c1g5b8d7d1b3f8e7e2e3e8g8f1e2f6e4g5e7d8e7c3e4d5e4.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3c7c6c1g5b8d7e2e3d8a5f3d2f8b4d1c2d5c4g5f6d7f6d2c4b4c3.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3c7c6e2e3b8d7d1c2f8d6b2b3e8g8f1e2e6e5c4d5f6d5c3d5c6d5.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3c7c6e2e3b8d7d1c2f8e7b2b3e8g8f1d3c6c5c4d5e6d5e1g1b7b6.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3c7c6e2e3b8d7f1d3d5c4d3c4b7b5c4b3f8e7e1g1e8g8f1e1c8b7.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3d5c4d1a4c7c6a4c4b7b5c4d3b8d7c1g5c8b7e2e3a7a6f1e2c6c5.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3d5c4e2e4f8b4c1g5c7c5f1c4c5d4f3d4b4c3b2c3d8a5c4b5b8d7.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3d5c4e2e4f8b4c1g5c7c5f1c4c5d4f3d4b4c3b2c3d8a5d4b5c8d7.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3d5c4e2e4f8b4c1g5c7c5f1c4c5d4f3d4b4c3b2c3d8a5d4b5f6e4.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3d5c4e2e4f8b4c1g5c7c5f1c4c5d4f3d4b4c3b2c3d8a5d4b5f6e4.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8b4c4d5e6d5d1a4b8c6c1g5h7h6g5f6d8f6e2e3e8g8f1e2c8e6.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8b4e2e3e8g8f1d3c7c5e1g1b8c6a2a3b4a5c3e2d5c4d3c4a5b6.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1f4e8g8e2e3b7b6c4d5e6d5f1d3c7c5e1g1c8b7a1c1b8d7.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1f4e8g8e2e3c7c5d4c5b8c6d1c2e7c5a2a3d8a5e1c1c5e7.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1f4e8g8e2e3c7c5d4c5e7c5a1c1b8c6c4d5e6d5f1e2d5d4.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1f4e8g8e2e3c7c5d4c5e7c5a2a3b8c6b2b4c5e7c4d5f6d5.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1f4e8g8e2e3c7c5d4c5e7c5d1c2b8c6a1d1d8a5a2a3c5e7.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5e8g8e2e3b8d7a1c1a7a6a2a3c7c6f1d3h7h6g5h4d5c4.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5e8g8e2e3b8d7a1c1a7a6c4d5e6d5f1d3c7c6d1c2f8e8.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5e8g8e2e3h7h6g5f6e7f6c4d5e6d5d1d2c8e6g2g3c7c5.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5e8g8e2e3h7h6g5h4f6e4h4e7d8e7a1c1c7c6f1d3e4c3.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5e8g8e2e3h7h6g5h4f6e4h4e7d8e7c4d5e4c3b2c3e6d5.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5e8g8e2e3h7h6g5h4f6e4h4e7d8e7d1c2e4c3c2c3d5c4.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5h7h6g5f6e7f6d1b3c7c6e1c1d5c4b3c4b7b5c4b3a7a5.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5h7h6g5f6e7f6d1b3c7c6e2e3b8d7a1d1e8g8f1d3b7b6.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5h7h6g5f6e7f6e2e3e8g8a1c1c7c6f1d3b8d7e1g1d5c4.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5h7h6g5h4e8g8a1c1d5c4e2e3c7c5f1c4c5d4f3d4c8d7.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5h7h6g5h4e8g8e2e3b7b6a1c1c8b7h4f6e7f6c4d5e6d5.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5h7h6g5h4e8g8e2e3b7b6f1e2b8d7e1g1c8b7a1c1c7c5.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5h7h6g5h4e8g8e2e3b7b6f1e2c8b7a1c1d5c4e2c4b8d7.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5h7h6g5h4e8g8e2e3b7b6f1e2c8b7a1c1d5c4e2c4b8d7.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5h7h6g5h4e8g8e2e3b7b6f1e2c8b7h4f6e7f6c4d5e6d5.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5h7h6g5h4e8g8e2e3b7b6f1e2c8b7h4f6e7f6c4d5e6d5.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5h7h6g5h4e8g8e2e3b7b6f1e2c8b7h4f6e7f6c4d5e6d5.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5h7h6g5h4e8g8e2e3b7b6f1e2c8b7h4f6e7f6c4d5e6d5.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5h7h6g5h4e8g8e2e3b7b6f1e2c8b7h4f6e7f6c4d5e6d5.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5h7h6g5h4e8g8e2e3b7b6f1e2c8b7h4f6e7f6c4d5e6d5.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c1g5h7h6g5h4e8g8e2e3b7b6f1e2c8b7h4f6e7f6c4d5e6d5.
d2d4g8f6c2c4e7e6g1f3d7d5b1c3f8e7c4d5e6d5c1f4c7c6d1c2g7g6e2e3c8f5f1d3f5d3c2d3b8d7.
d2d4g8f6c2c4e7e6g1f3d7d5c1g5b8d7e2e3f8e7b1c3e8g8d1c2c7c5c4d5c5d4f3d4f6d5g5e7d8e7.
d2d4g8f6c2c4e7e6g1f3d7d5g2g3d5c4d1a4b8d7f1g2a7a6a4c4b7b5c4c6a8b8c1g5c8b7c6c2c7c5.
d2d4g8f6c2c4e7e6g1f3d7d5g2g3d5c4f1g2c7c5e1g1b8c6d1a4c5d4f3d4d8d4g2c6c8d7f1d1d4d1.
d2d4g8f6c2c4e7e6g1f3f8b4b1c3c7c5e2e3e8g8f1e2b7b6e1g1c8b7d1b3c5d4b3b4b8c6b4a3d4c3.
d2d4g8f6c2c4e7e6g1f3f8b4b1d2d7d5d1a4b8c6a2a3b4d2c1d2f6e4a4c2a7a5e2e3e8g8f1d3f7f5.
d2d4g8f6c2c4e7e6g1f3f8b4b1d2e8g8a2a3b4e7e2e4d7d5e4e5f6d7f1d3c7c5c4d5e6d5e1g1b8c6.
d2d4g8f6c2c4e7e6g1f3f8b4c1d2a7a5b1c3e8g8e2e3d7d6d1c2b8d7a2a3b4c3d2c3d8e7f1e2a5a4.
d2d4g8f6c2c4e7e6g1f3f8b4c1d2a7a5b1c3e8g8e2e3d7d6d1c2b8d7f1d3e6e5e1g1f8e8e3e4e5d4.
d2d4g8f6c2c4e7e6g1f3f8b4c1d2a7a5g2g3d7d5d1c2b8c6a2a3b4e7f1g2d5c4c2c4d8d5c4d3e8g8.
d2d4g8f6c2c4e7e6g1f3f8b4c1d2b4d2d1d2e8g8g2g3b7b6f1g2c8b7b1c3f6e4c3e4b7e4e1g1d7d6.
d2d4g8f6c2c4e7e6g1f3f8b4c1d2c7c5d2b4c5b4a2a3b4a3a1a3d7d6e2e3e8g8f1e2b7b6e1g1a7a5.
d2d4g8f6c2c4e7e6g1f3f8b4c1d2d8e7b1c3b4c3d2c3f6e4d1c2e4c3c2c3d7d6a1c1e8g8c4c5b8d7.
d2d4g8f6c2c4e7e6g1f3f8b4c1d2d8e7g2g3b8c6b1c3d7d5c4d5e6d5f1g2e8g8e1g1a7a5d1c2c8g4.
d2d4g8f6c2c4e7e6g1f3f8b4c1d2d8e7g2g3b8c6b1c3e8g8f1g2d7d6e1g1b4c3d2c3e6e5d1c2a7a5.
d2d4g8f6c2c4e7e6g2g3c7c5d4d5e6d5c4d5b7b5f1g2d7d6a2a3a7a5b1c3d8b6g1f3f8e7e1g1e8g8.
d2d4g8f6c2c4e7e6g2g3c7c5d4d5e6d5c4d5b7b5f1g2d7d6a2a3a7a5b1c3d8b6g1f3f8e7e1g1e8g8.
d2d4g8f6c2c4e7e6g2g3c7c5d4d5e6d5c4d5b7b5f1g2d7d6b2b4b8a6b4c5a6c5g1f3g7g6e1g1f8g7.
d2d4g8f6c2c4e7e6g2g3c7c5d4d5e6d5c4d5d7d6b1c3g7g6g1f3f8g7f1g2e8g8e1g1a7a6a2a4b8d7.
d2d4g8f6c2c4e7e6g2g3c7c5d4d5e6d5c4d5f8d6b1c3d6e5d5d6d8b6g1f3e5d6c1g5d6e7f1h3e8g8.
d2d4g8f6c2c4e7e6g2g3c7c5g1f3c5d4f3d4d7d5f1g2e6e5d4f3d5d4e1g1b8c6e2e3f8c5e3d4c5d4.
d2d4g8f6c2c4e7e6g2g3d7d5f1g2b8c6b1c3f8b4a2a3b4c3b2c3e8g8c1g5d5c4e2e4h7h6g5f6d8f6.
d2d4g8f6c2c4e7e6g2g3d7d5f1g2c7c6d1a4b8d7b1d2d5c4a4c4e6e5g1f3d7b6c4d3e5d4d3d4d8d4.
d2d4g8f6c2c4e7e6g2g3d7d5f1g2d5c4d1a4b8d7g1f3c7c5b1c3a7a6e1g1f8e7d4c5e7c5a4c4b7b5.
d2d4g8f6c2c4e7e6g2g3d7d5f1g2d5c4d1a4c8d7a4c4d7c6g1f3b8d7b1c3d7b6c4d3f8b4e1g1e8g8.
d2d4g8f6c2c4e7e6g2g3d7d5f1g2d5c4d1a4c8d7a4c4d7c6g1f3c6d5c4a4d8d7a4d7b8d7e1g1c7c5.
d2d4g8f6c2c4e7e6g2g3d7d5f1g2d5c4g1f3b8d7e1g1a8b8a2a4b7b6f3d2e6e5d2c4e5d4d1d4f8c5.
d2d4g8f6c2c4e7e6g2g3d7d5f1g2d5c4g1f3c7c5e1g1b8c6d1a4c8d7a4c4b7b5c4d3a8c8d4c5f8c5.
d2d4g8f6c2c4e7e6g2g3d7d5f1g2d5c4g1f3c7c5e1g1b8c6d1a4c8d7a4c4c5d4f3d4a8c8b1c3d8a5.
d2d4g8f6c2c4e7e6g2g3d7d5f1g2d5c4g1f3c7c5e1g1b8c6d4c5d8d1f1d1f8c5b1d2e8e7d2c4f6g4.
d2d4g8f6c2c4e7e6g2g3d7d5f1g2d5c4g1f3c7c5e1g1b8c6f3e5c8d7b1a3c5d4a3c4f8c5d1b3e8g8.
d2d4g8f6c2c4e7e6g2g3d7d5f1g2d5c4g1f3c7c5e1g1b8d7b1a3d7b6a3c4b6c4d1a4c8d7a4c4b7b5.
d2d4g8f6c2c4e7e6g2g3d7d5f1g2d5c4g1f3c8d7d1c2c7c5e1g1d7c6c2c4b8d7c1g5a8c8g5f6d7f6.
d2d4g8f6c2c4e7e6g2g3d7d5f1g2d5c4g1f3c8d7d1c2c7c5f3e5b8c6e5c6d7c6g2c6b7c6d4c5f8c5.
d2d4g8f6c2c4e7e6g2g3d7d5f1g2d5c4g1f3f8b4c1d2b4e7d1c2c8d7e1g1d7c6c2c4c6d5c4c2b8c6.
d2d4g8f6c2c4e7e6g2g3d7d5f1g2f8e7g1f3e8g8e1g1c7c6b2b3b8d7c1b2b7b6b1d2c8b7a1c1a8c8.
d2d4g8f6c2c4e7e6g2g3d7d5f1g2f8e7g1f3e8g8e1g1d5c4d1c2a7a6a2a4c8d7c2c4d7c6c1g5a6a5.
d2d4g8f6c2c4e7e6g2g3d7d5f1g2f8e7g1f3e8g8e1g1d5c4d1c2a7a6c2c4b7b5c4c2c8b7c1d2b7e4.
d2d4g8f6c2c4e7e6g2g3d7d5f1g2f8e7g1f3e8g8e1g1d5c4d1c2a7a6c2c4b7b5c4c2c8b7c1g5b8d7.
d2d4g8f6c2c4e7e6g2g3d7d5g1f3c7c6f1g2b8d7d1c2f8d6b1d2e8g8e1g1f8e8f1e1e6e5c4d5c6d5.
d2d4g8f6c2c4e7e6g2g3d7d5g1f3d5c4d1a4b8d7a4c4c7c5f1g2d7b6c4d3c5d4e1g1f8e7f3d4e8g8.
d2d4g8f6c2c4e7e6g2g3d7d5g1f3f8e7f1g2e8g8e1g1d5c4d1c2a7a6a2a4c8d7f1d1d7c6b1c3e7b4.
d2d4g8f6c2c4e7e6g2g3f8b4b1d2f6e4g1f3f7f5f1g2e8g8e1g1b8c6d4d5e4d2c1d2b4d2d1d2c6e7.
d2d4g8f6c2c4e7e6g2g3f8b4c1d2b4e7f1g2d7d5c4d5e6d5b1c3e8g8e2e3c7c6g1e2b8a6e1g1a6c7.
d2d4g8f6c2c4e7e6g2g3f8b4c1d2b4e7f1g2d7d5g1f3e8g8e1g1c7c6d1b3b8d7d2g5b7b6f1e1c8b7.
d2d4g8f6c2c4e7e6g2g3f8b4c1d2b4e7f1g2d7d5g1f3e8g8e1g1c7c6d1c2b7b6d2f4c8b7b1d2b8d7.
d2d4g8f6c2c4e7e6g2g3f8b4c1d2b4e7f1g2d7d5g1f3e8g8e1g1c7c6d1c2b7b6d2g5b8d7b1d2c8b7.
d2d4g8f6c2c4e7e6g2g3f8b4c1d2b4e7f1g2d7d5g1f3e8g8e1g1c7c6d1c2b7b6f3e5c8b7c4d5c6d5.
d2d4g8f6c2c4e7e6g2g3f8b4c1d2b4e7g1f3d7d5f1g2e8g8e1g1c7c6d1b3b7b6b1c3c8b7a1c1b8d7.
d2d4g8f6c2c4g7g6b1c3d7d5c1f4e7e6e2e3f8g7g1f3e8g8d1b3c7c6f1e2f8e8e1g1b8d7f1d1d5c4.
d2d4g8f6c2c4g7g6b1c3d7d5c1f4f6h5f4e5f7f6e5g3h5g3h2g3c7c6e2e3f8g7f1d3e8g8h1h7f6f5.
d2d4g8f6c2c4g7g6b1c3d7d5c1f4f8g7e2e3c7c5d4c5d8a5a1c1d5c4f1c4e8g8g1f3a5c5c4b3b8c6.
d2d4g8f6c2c4g7g6b1c3d7d5c1f4f8g7e2e3c7c5d4c5d8a5a1c1d5c4f1c4e8g8g1f3a5c5c4b3b8c6.
d2d4g8f6c2c4g7g6b1c3d7d5c1f4f8g7e2e3c7c5d4c5d8a5a1c1d5c4f1c4e8g8g1f3b8c6e1g1a5c5.
d2d4g8f6c2c4g7g6b1c3d7d5c1f4f8g7e2e3c7c5d4c5d8a5a1c1f6e4c4d5e4c3d1d2a5a2b2c3a2a5.
d2d4g8f6c2c4g7g6b1c3d7d5c1f4f8g7e2e3c7c5d4c5d8a5a1c1f6e4c4d5e4c3d1d2a5a2b2c3a2d2.
d2d4g8f6c2c4g7g6b1c3d7d5c1f4f8g7e2e3c7c6a1c1e8g8g1f3c8g4h2h3g4f3d1f3d8a5f1d3b8d7.
d2d4g8f6c2c4g7g6b1c3d7d5c1f4f8g7e2e3e8g8c4d5f6d5c3d5d8d5f4c7b8a6f1a6d5g2d1f3g2f3.
d2d4g8f6c2c4g7g6b1c3d7d5c1f4f8g7e2e3e8g8d1b3c7c5c4d5c5d4e3d4e7e6d5e6b8c6e6f7g8h8.
d2d4g8f6c2c4g7g6b1c3d7d5c1f4f8g7g1f3e8g8e2e3c7c5d4c5f6e4f4e5g7e5f3e5e4c3b2c3d8a5.
d2d4g8f6c2c4g7g6b1c3d7d5c1g5f6e4g5f4c7c6e2e3f8g7f1d3e4c3b2c3d8a5g1e2d5c4d3c4b8d7.
d2d4g8f6c2c4g7g6b1c3d7d5c1g5f6e4g5h4e4c3b2c3d5c4e2e3c8e6a1b1b7b6f1e2f8h6g1f3c7c6.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5b6h2h3f8g7g1f3e8g8f1e2a7a5e1g1a5a4a2a3f7f5.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3c7c5f1c4f8g7g1e2c5d4c3d4b8c6c1e3d8a5.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3c7c5f1c4f8g7g1e2c5d4c3d4b8c6c1e3e8g8.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3c7c5f1c4f8g7g1e2e8g8e1g1b8c6c1e3c6a5.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3c7c5f1c4f8g7g1e2e8g8e1g1b8d7c1g5h7h6.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3c7c5f1c4f8g7g1e2e8g8e1g1c5d4c3d4b8c6.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7c1e3c7c5d1d2c5d4c3d4b8c6a1d1d8a5.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7c1e3c7c5d1d2d8a5a1b1b7b6f1b5c8d7.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7c1e3c7c5d1d2d8a5a1b1c5d4c3d4a5d2.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7c1e3c7c5d1d2d8a5a1c1c5d4c3d4a5d2.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7c1e3c7c5d1d2e8g8a1c1d8a5g1f3e7e6.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7c1e3c7c5d1d2e8g8g1f3c8g4f3g5c5d4.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7c1e3c7c5d1d2e8g8g1f3d8a5a1c1e7e6.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7f1c4b7b6d1f3e8g8e4e5c8a6c4d5c7c6.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7f1c4b7b6d1f3e8g8g1e2b8c6h2h4c6a5.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7f1c4c7c5g1e2b8c6c1e3e8g8e1g1c5d4.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7f1c4c7c5g1e2b8c6c1e3e8g8e1g1c8g4.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7f1c4c7c5g1e2b8c6c1e3e8g8e1g1c8g4.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7f1c4c7c5g1e2b8c6c1e3e8g8e1g1c8g4.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7f1c4c7c5g1e2b8c6c1e3e8g8e1g1c8g4.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7f1c4c7c5g1e2b8c6c1e3e8g8e1g1c8g4.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7f1c4c7c5g1e2b8c6c1e3e8g8e1g1d8c7.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7f1c4c7c5g1e2e8g8c1e3b8c6a1c1c5d4.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7f1c4c7c5g1e2e8g8e1g1b8c6c1e3d8c7.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7f1c4e8g8g1e2b7b6e1g1c8b7f2f3c7c5.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7f1c4e8g8g1e2c7c5e1g1b8c6c1e3d8c7.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7f1c4e8g8g1e2c7c5e1g1b8c6c1e3d8c7.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7f1c4e8g8g1e2c7c5e1g1b8c6c1e3d8c7.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7f1c4e8g8g1e2c7c5e1g1b8c6c1e3d8c7.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7g1f3c7c5a1b1e8g8f1e2c5d4c3d4d8a5.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7g1f3c7c5a1b1e8g8f1e2c5d4c3d4d8a5.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5e2e4d5c3b2c3f8g7g1f3c7c5c1e3d8a5d1d2c8g4a1c1b8c6.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5g1f3f8g7e2e4d5c3b2c3c7c5a1b1e8g8f1e2b8c6d4d5c6e5.
d2d4g8f6c2c4g7g6b1c3d7d5c4d5f6d5g2g3f8g7f1g2d5c3b2c3c7c5e2e3e8g8g1e2b8c6e1g1d8a5.
d2d4g8f6c2c4g7g6b1c3d7d5d1b3d5c4b3c4c8e6c4b5b8c6g1f3a8b8f3e5e6d7e5d7d8d7d4d5c6d4.
d2d4g8f6c2c4g7g6b1c3d7d5d1b3d5c4b3c4f8g7c1f4c7c6a1d1d8a5f4d2b7b5c4b3b5b4c3a4b8a6.
d2d4g8f6c2c4g7g6b1c3d7d5d1b3d5c4b3c4f8g7e2e4e8g8f1e2b8c6g1f3f6d7c1e3d7b6c4c5c8g4.
d2d4g8f6c2c4g7g6b1c3d7d5d1b3d5c4b3c4f8g7e2e4e8g8g1f3a7a6c1f4b7b5c4c7d8e8f1e2b8c6.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7c1f4c7c5d4c5d8a5a1c1d5c4e2e3a5c5d1a4b8c6f1c4e8g8.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7c1f4e8g8a1c1c7c5d4c5d5c4e2e4d8a5e4e5f8d8f4d2f6g4.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7c1f4e8g8a1c1d5c4e2e4c8g4f1c4f6h5f4e3g4f3g2f3e7e6.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7c1f4e8g8e2e3c7c5d4c5d8a5a1c1d5c4f1c4a5c5c4b3b8c6.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7c1f4e8g8e2e3c7c6d1b3d8a5h2h3b8d7a1c1d5c4f1c4d7b6.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7c1g5f6e4c4d5e4g5f3g5e7e6d1d2e6d5d2e3e8f8e3f4d8f6.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7c1g5f6e4c4d5e4g5f3g5e7e6g5f3e6d5e2e3e8g8f1d3b7b6.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7c4d5f6d5e2e4d5c3b2c3c7c5a1b1e8g8f1e2c5d4c3d4d8a5.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7c4d5f6d5e2e4d5c3b2c3c7c5c1e3c8g4a1c1d8a5d1d2b8d7.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7c4d5f6d5e2e4d5c3b2c3c7c5c1e3c8g4a1c1d8a5d1d2b8d7.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7c4d5f6d5e2e4d5c3b2c3c7c5c1e3d8a5d1d2e8g8a1c1c5d4.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3c7c6c4d5f6d5e2e4d5b6c1e3c8e6b3c2e6c4f1e2b8a6.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4c7c6e2e4e8g8c4b3b7b5e4e5f6e8a2a4b5a4.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4a7a6e4e5b7b5c4b3f6d7c1e3c7c5.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4a7a6e4e5b7b5c4b3f6d7c1e3c7c5.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4a7a6e4e5b7b5c4b3f6d7e5e6f7e6.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4b8a6b2b4c7c6a1b1a6c7h2h3c7b5.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4b8a6f1e2c7c5d4d5e7e6e1g1e6d5.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4b8a6f1e2c7c5d4d5e7e6e1g1e6d5.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4b8a6f1e2c7c5d4d5e7e6e1g1e6d5.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4b8a6f1e2c7c5d4d5e7e6e1g1e6d5.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4b8c6f1e2c8g4c1e3g4f3e2f3e7e5.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4b8c6h2h3e7e5d4e5f6d7e5e6f7e6.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4c7c6c4b3e7e5d4e5f6g4f1e2d8b6.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4c8g4c1e3f6d7a1d1b8c6f1e2d7b6.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4c8g4c1e3f6d7a1d1b8c6f1e2d7b6.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4c8g4c1e3f6d7a1d1b8c6f1e2g4f3.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4c8g4c1e3f6d7a1d1d7b6c4b3b8c6.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4c8g4c1e3f6d7c4b3c7c5d4d5b8a6.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4c8g4c1e3f6d7c4b3d7b6a1d1e7e5.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4c8g4c1e3f6d7c4b3d7b6a2a4a7a5.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4c8g4c1e3f6d7c4b3d7b6a2a4a7a5.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4c8g4c1e3f6d7e1c1b8c6h2h3g4f3.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4c8g4c1e3f6d7f1e2d7b6c4c5c7c6.
d2d4g8f6c2c4g7g6b1c3d7d5g1f3f8g7d1b3d5c4b3c4e8g8e2e4c8g4c1e3f6d7f3d2d7b6c4d3c7c6.
d2d4g8f6c2c4g7g6b1c3f8g7c1g5c7c5d4c5b8a6g2g3a6c5f1g2d7d6a1c1e8g8b2b4c5e6g5d2a7a5.
d2d4g8f6c2c4g7g6b1c3f8g7c1g5d7d6e2e3c7c5d4d5h7h6g5h4e8g8g1f3c8f5f3d2d8b6d1c1g6g5.
d2d4g8f6c2c4g7g6b1c3f8g7c1g5d7d6e2e3c7c5g1f3d8a5d1d2e8g8f1e2h7h6g5h4b8c6h2h3a7a6.
d2d4g8f6c2c4g7g6b1c3f8g7c1g5d7d6e2e3e8g8g1f3c7c5f1e2h7h6g5h4c5d4f3d4b8c6e1g1c8d7.
d2d4g8f6c2c4g7g6b1c3f8g7e2e3d7d6g1f3b8d7f1e2e8g8e1g1e7e5d4e5d6e5d1c2c7c6e3e4d8e7.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6c1g5c7c5d4d5b8a6f1d3a6c7g1e2a7a6a2a4a8b8e1g1e8g8.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f1d3e7e5d4d5a7a5g1e2b8a6f2f3f6d7c1e3g7h6d1d2h6e3.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f1e2e8g8c1g5b8a6h2h4e7e5d4d5c7c6h4h5c6d5c4d5d8b6.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f1e2e8g8c1g5c7c5d4c5d8a5g5d2a5c5g1f3c8g4d2e3c5a5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f1e2e8g8c1g5c7c5d4d5b7b5c4b5a7a6a2a4h7h6g5d2b8d7.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f1e2e8g8c1g5c7c5d4d5e7e6g1f3e6d5e4d5c8g4e1g1g4f3.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f1e2e8g8c1g5c7c5d4d5h7h6g5f4e7e6d5e6c8e6f4d6f8e8.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f1e2e8g8c1g5c7c5d4d5h7h6g5f4e7e6d5e6c8e6f4d6f8e8.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f1e2e8g8c1g5h7h6g5e3c7c5d4c5d8a5e3d2a5c5g1f3c8g4.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f1e2e8g8c1g5h7h6g5e3c7c5d4c5d8a5e3d2a5c5g1f3c8g4.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f1e2e8g8c1g5h7h6g5e3e7e5d4d5b8a6d1d2a6c5f2f3f6h5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f1e2e8g8g1f3e7e5d4d5b8d7c1g5h7h6g5h4a7a6e1g1d8e8.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f1e2e8g8g1f3e7e5d4d5b8d7c1g5h7h6g5h4a7a6f3d2d8e8.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f1e2e8g8g1f3e7e5e1g1b8c6c1e3f8e8d4d5c6d4f3d4e5d4.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f1e2e8g8g1f3e7e5e1g1b8c6d4d5c6e7c1d2f6e8a1c1c7c5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f1e2e8g8g1f3e7e5e1g1b8c6d4d5c6e7c1d2f6e8b2b4f7f5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f1e2e8g8g1f3e7e5e1g1b8c6d4d5c6e7f3d2a7a5b2b3f6d7.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f1e2e8g8g1f3e7e5e1g1b8c6d4d5c6e7f3e1f6d7c1e3f7f5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3b8d7c1e3e7e5g1e2e8g8d4d5f6h5d1d2f7f5e1c1a7a6.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3c7c5d4c5d6c5d1d8e8d8c1e3f6d7g1e2b7b6e1c1b8a6.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e7e5d4d5f6h5c1e3b8a6d1d2d8h4g2g3h5g3d2f2g3f1.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3a7a6f1d3b8c6g1e2a8b8a2a3f6d7d3b1c6a5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3a7a6f1d3c7c5d4c5d6c5e3c5b8c6g1e2f6d7.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3b8c6g1e2a7a6d1d2a8b8h2h4h7h5e3h6e7e5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3b8c6g1e2a7a6e2c1e7e5d4d5c6d4c1b3d4b3.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3b8c6g1e2a7a6h2h4h7h5e2c1e7e5d4d5c6d4.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3b8c6g1e2a7a6h2h4h7h5e2c1e7e5d4d5c6e7.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3b8c6g1e2a7a6h2h4h7h5e2c1f6d7c1b3a6a5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3b8d7d1d2c7c5d4c5d6c5e1c1d8a5c1b1d7e5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3b8d7d1d2c7c5g1h3d8a5h3f2a7a6d4c5d7c5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3c7c5d4d5e7e6d1d2e6d5c4d5a7a6a2a4f8e8.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3c7c6f1d3a7a6g1e2b7b5e1g1b8d7a1c1e7e5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3c7c6f1d3e7e5g1e2e5d4e3d4c6c5d4f2b8c6.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3e7e5d4d5c7c5f1d3f6h5g1e2f7f5e4f5g6f5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3e7e5d4d5c7c6d1d2c6d5c4d5a7a6g2g4b8d7.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3e7e5d4d5c7c6f1d3c6d5c4d5f6h5g1e2f7f5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3e7e5d4d5c7c6f1d3c6d5c4d5f6h5g1e2f7f5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3e7e5d4d5f6h5d1d2d8h4g2g3h4e7e1c1f7f5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3e7e5d4d5f6h5d1d2f7f5e1c1a7a6f1d3c7c5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3e7e5d4d5f6h5d1d2f7f5e1c1b8d7f1d3d7c5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3e7e5d4d5f6h5d1d2f7f5e1c1f5f4e3f2g7f6.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3e7e5d4d5f6h5d1d2f7f5e1c1f5f4e3f2g7f6.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3e7e5d4e5d6e5d1d8f8d8c3d5f6d5c4d5c7c6.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3e7e5d4e5d6e5d1d8f8d8c3d5f6d5c4d5c7c6.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1e3e7e5g1e2c7c6d4d5c6d5c4d5a7a6d1d2b8d7.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1g5c7c5d4d5a7a6d1d2f8e8g1e2b8d7e2g3d7f8.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1g5c7c5d4d5e7e6d1d2e6d5c4d5h7h6g5e3f8e8.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1g5c7c5d4d5e7e6d1d2e6d5c4d5h7h6g5e3h6h5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1g5c7c5d4d5e7e6d1d2h7h6g5e3e6d5c4d5h6h5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8c1g5h7h6g5e3c7c5d4c5d6c5d1d8f8d8e3c5b8c6.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8g1e2b8c6c1e3a7a6d1d2a8b8e2c1e7e5c1b3e5d4.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f3e8g8g1e2b8c6c1e3a7a6d1d2c8d7e2c1e7e5c1b3e5d4.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f4c7c5d4c5d8a5f1d3a5c5g1f3e8g8d1e2b8c6c1e3c5h5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f4c7c5d4d5e8g8g1f3e7e6f1e2e6d5c4d5b7b5e4e5d6e5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f4e8g8g1f3b8a6f1d3c8g4e1g1f6d7c1e3e7e5f4e5c7c5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6f2f4e8g8g1f3c7c5d4d5e7e6f1e2e6d5c4d5b7b5e4e5f6d7.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2c7c5e1g1c8g4d4d5b8d7c1g5a7a6a2a4d8c7.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5c1e3b8a6e1g1c7c6d4e5d6e5d1d8f8d8.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5c1e3b8a6e1g1f6g4e3g5f7f6g5c1g8h8.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5c1e3b8c6d4d5c6e7f3d2f6e8c4c5f7f5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5c1e3c7c6d1d2f8e8d4d5f6g4e3g5f7f6.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5c1e3c7c6d4d5f6g4e3g5f7f6g5h4b8a6.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5c1e3c7c6d4d5f6g4e3g5f7f6g5h4b8a6.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5c1e3d8e7d4e5d6e5c3d5e7d8e3c5f6e4.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5c1e3d8e7d4e5d6e5c3d5f6d5c4d5f8d8.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5c1e3e5d4f3d4f8e8f2f3c7c6d1d2d6d5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5c1e3f6g4e3g5f7f6g5c1b8c6e1g1f6f5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5c1e3f6g4e3g5f7f6g5c1e5d4f3d4f6f5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5c1e3f6g4e3g5f7f6g5h4g6g5h4g3g4h6.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5d4d5b8d7c1g5h7h6g5h4a7a6f3d2d8e8.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5d4d5b8d7c1g5h7h6g5h4g6g5h4g3f6h5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5d4e5d6e5d1d8f8d8c1g5d8e8c3d5f6d5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5e1g1b8a6c1e3c7c6d1c2f6g4e3g5f7f6.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5e1g1b8c6d4d5c6e7b2b4f6h5f1e1h5f4.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5e1g1b8c6d4d5c6e7b2b4f6h5f1e1h7h6.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5e1g1b8c6d4d5c6e7c1d2f6e8a1c1f7f5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5e1g1b8c6d4d5c6e7c1d2f6e8a1c1f7f5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5e1g1b8c6d4d5c6e7f3e1f6d7c1e3f7f5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5e1g1b8c6d4d5c6e7f3e1f6d7e1d3f7f5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5e1g1c7c6c1e3b8a6d4d5f6g4e3g5f7f6.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5e1g1c7c6d4d5c6c5f3e1a7a6c1e3f6e8.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8f1e2e7e5e1g1c7c6f1e1e5d4f3d4f8e8e2f1f6g4.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g1f3e8g8g2g3c8g4f1g2f6d7e1g1b8c6c1e3e7e5d4d5g4f3.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6g2g3e8g8f1g2e7e5g1e2e5d4e2d4b8c6d4c6b7c6e1g1f6d7.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4d7d6h2h3e8g8c1e3e7e5d4d5b8d7g2g4d7c5d1c2c7c6g1e2c6d5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4e8g8f2f4d7d6g1f3b8a6f1e2e7e5d4e5d6e5d1d8f8d8f3e5a6c5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4e8g8g1f3d7d6f1e2e7e5e1g1b8c6d4d5c6e7f3e1f6d7f2f3f7f5.
d2d4g8f6c2c4g7g6b1c3f8g7e2e4e8g8g1f3d7d6f1e2e7e5e1g1b8d7f1e1c7c6e2f1f8e8d4d5c6c5.
d2d4g8f6c2c4g7g6b1c3f8g7g1f3d7d6c1f4b8d7h2h3c7c5e2e3e8g8f1e2b7b6e1g1c8b7d4d5a7a6.
d2d4g8f6c2c4g7g6b1c3f8g7g1f3e8g8c1g5c7c5e2e3d7d6f1e2h7h6g5h4c8g4d1b3c5d4f3d4g4e2.
d2d4g8f6c2c4g7g6b1c3f8g7g1f3e8g8e2e4d7d6f1e2e7e5e1g1e5d4f3d4f8e8f2f3c7c6g1h1a7a6.
d2d4g8f6c2c4g7g6b1c3f8g7g2g3d7d5c4d5f6d5f1g2c8e6c3e4e8g8g1f3b8a6e1g1c7c6a2a3e6f5.
d2d4g8f6c2c4g7g6b1c3f8g7g2g3d7d5c4d5f6d5f1g2d5c3b2c3c7c5e2e3b8c6g1e2c8d7e1g1a8c8.
d2d4g8f6c2c4g7g6e2e3d7d5c4d5f6d5e3e4d5b6b1c3f8g7c1e3b8c6d4d5c6e5e3d4f7f6f2f4e5f7.
d2d4g8f6c2c4g7g6f2f3d7d5c4d5f6d5e2e4d5b6c1e3f8g7b1c3e8g8f3f4f7f5d1b3e7e6e4e5b8c6.
d2d4g8f6c2c4g7g6f2f3f8g7e2e4e8g8b1c3c7c6c1e3d7d5e4e5f6d7c4d5c6d5c3d5d8a5d5c3b8c6.
d2d4g8f6c2c4g7g6g1f3f8g7g2g3c7c6f1g2d7d5c4d5c6d5b1c3e8g8f3e5e7e6c1g5d8b6d1d2f6d7.
d2d4g8f6c2c4g7g6g1f3f8g7g2g3c7c6f1g2d7d5c4d5c6d5b1c3e8g8f3e5e7e6e1g1f6d7e5f3b8c6.
d2d4g8f6c2c4g7g6g1f3f8g7g2g3c7c6f1g2d7d5c4d5c6d5b1c3e8g8f3e5e7e6e1g1f6d7f2f4b8c6.
d2d4g8f6c2c4g7g6g1f3f8g7g2g3c7c6f1g2d7d5c4d5c6d5b1c3e8g8f3e5e7e6e1g1f6d7f2f4f7f6.
d2d4g8f6c2c4g7g6g1f3f8g7g2g3c7c6f1g2d7d5c4d5c6d5f3e5e8g8b1c3e7e6e1g1f6d7f2f4b8c6.
d2d4g8f6c2c4g7g6g1f3f8g7g2g3e8g8f1g2c7c6b1c3d7d5c4d5c6d5e1g1f6e4f3e5e4c3b2c3b8c6.
d2d4g8f6c2c4g7g6g1f3f8g7g2g3e8g8f1g2c7c6b1c3d7d5c4d5c6d5f3e5e7e6e1g1b8c6e5c6b7c6.
d2d4g8f6c2c4g7g6g1f3f8g7g2g3e8g8f1g2c7c6b1c3d7d5c4d5c6d5f3e5e7e6e1g1f6d7e5f3b8c6.
d2d4g8f6c2c4g7g6g1f3f8g7g2g3e8g8f1g2c7c6b1c3d7d5c4d5c6d5f3e5e7e6e1g1f6d7e5f3b8c6.
d2d4g8f6c2c4g7g6g1f3f8g7g2g3e8g8f1g2c7c6e1g1d7d5b2b3a7a5b1c3f6e4c1b2c8f5a1c1b8d7.
d2d4g8f6c2c4g7g6g1f3f8g7g2g3e8g8f1g2c7c6e1g1d7d5c4d5c6d5b1c3f6e4c3e4d5e4f3e5f7f6.
d2d4g8f6c2c4g7g6g1f3f8g7g2g3e8g8f1g2c7c6e1g1d7d5c4d5c6d5b1c3f6e4f3e5c8f5c1f4e7e6.
d2d4g8f6c2c4g7g6g1f3f8g7g2g3e8g8f1g2d7d5c4d5f6d5e1g1d5b6b1c3b8c6e2e3a7a5d4d5c6b4.
d2d4g8f6c2c4g7g6g1f3f8g7g2g3e8g8f1g2d7d5c4d5f6d5e1g1d5b6b1c3b8c6e2e3e7e5d4d5e5e4.
d2d4g8f6c2c4g7g6g1f3f8g7g2g3e8g8f1g2d7d6e1g1b8c6b1c3a7a6c1g5h7h6g5d2e7e5d4d5c6d4.
d2d4g8f6c2c4g7g6g1f3f8g7g2g3e8g8f1g2d7d6e1g1b8c6b1c3a7a6d4d5c6a5f3d2c7c5d1c2a8b8.
d2d4g8f6c2c4g7g6g1f3f8g7g2g3e8g8f1g2d7d6e1g1b8c6b1c3a7a6f1e1a8b8a1b1c6a5b2b3b7b5.
d2d4g8f6c2c4g7g6g1f3f8g7g2g3e8g8f1g2d7d6e1g1b8d7b1c3e7e5h2h3c7c6e2e4d8b6c4c5d6c5.
d2d4g8f6c2c4g7g6g2g3c7c5d4d5d7d6f1g2f8g7b1c3a7a6a2a4e8g8g1f3e7e5e1g1a6a5e2e4f6e8.
d2d4g8f6c2c4g7g6g2g3c7c5g1f3c5d4f3d4d8a5b1c3f6e4d1c2e4f6c1d2a5c5c2d3f8g7d4b3c5h5.
d2d4g8f6c2c4g7g6g2g3c7c6b1c3d7d5c4d5c6d5g1h3f8g7h3f4e8g8f1g2e7e6e1g1b8c6e2e3b7b6.
d2d4g8f6c2c4g7g6g2g3c7c6d4d5c6d5c4d5d7d6b1c3f8g7f1g2d8a5c1d2e8g8e2e3b8d7g1e2d7e5.
d2d4g8f6c2c4g7g6g2g3c7c6d4d5c6d5c4d5d7d6f1g2f8g7b1c3e8g8g1f3b8d7e1g1d7b6a2a4c8g4.
d2d4g8f6c2c4g7g6g2g3c7c6d4d5f8g7f1g2d7d6b1c3e8g8g1f3e7e5e1g1c6d5c4d5b8d7f3d2a7a5.
d2d4g8f6c2c4g7g6g2g3c7c6f1g2d7d5c4d5c6d5b1c3f8g7g1f3e8g8f3e5c8f5e1g1f6e4c3e4f5e4.
d2d4g8f6c2c4g7g6g2g3c7c6f1g2d7d5c4d5c6d5b1c3f8g7g1f3e8g8f3e5e7e6e1g1f6d7f2f4b8c6.
d2d4g8f6c2c4g7g6g2g3c7c6f1g2d7d5c4d5c6d5b1c3f8g7g1h3c8h3g2h3b8c6h3g2e7e6e2e3e8g8.
d2d4g8f6c2c4g7g6g2g3c7c6f1g2d7d5c4d5c6d5g1f3f8g7b1c3e8g8f3e5e7e6e1g1f6d7f2f4b8c6.
d2d4g8f6c2c4g7g6g2g3c7c6f1g2d7d5c4d5c6d5g1f3f8g7b1c3f6e4d1b3e4c3b2c3b8c6f3d2e7e6.
d2d4g8f6c2c4g7g6g2g3c7c6f1g2d7d5c4d5c6d5g1f3f8g7f3e5e8g8b1c3e7e6e1g1f6d7f2f4b8c6.
d2d4g8f6c2c4g7g6g2g3c7c6f1g2d7d5g1f3f8g7b2b3e8g8e1g1f6e4c1b2a7a5b1c3e4c3b2c3b7b5.
d2d4g8f6c2c4g7g6g2g3c7c6f1g2d7d5g1f3f8g7e1g1e8g8b1c3d5c4f3e5c8e6e2e4b8d7f2f4d8b6.
d2d4g8f6c2c4g7g6g2g3c7c6f1g2d7d5g1f3f8g7e1g1e8g8c1f4f6e4b1c3c8f5d1b3d8b6c4d5b6b3.
d2d4g8f6c2c4g7g6g2g3c7c6g1f3f8g7f1g2d7d5c4d5c6d5b1c3e8g8f3e5e7e6e1g1f6d7f2f4b8c6.
d2d4g8f6c2c4g7g6g2g3d7d5c4d5f6d5f1g2f8g7g1f3e8g8e1g1d5b6b1c3a7a5c1f4c7c6d1c1f8e8.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2c7c5d4d5d7d6g1f3c8f5b1c3f6e4c3e4f5e4e1g1e8g8d1b3b8d7.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2d7d5c4d5f6d5e2e4d5b6g1e2c7c5d4d5e7e6e1g1e8g8a2a4b8a6.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2d7d5c4d5f6d5e2e4d5b6g1e2c7c5d4d5e7e6e1g1e8g8e2c3e6d5.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2d7d5c4d5f6d5e2e4d5b6g1e2c8g4f2f3g4c8b1c3b8c6d4d5c6b8.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2d7d5c4d5f6d5e2e4d5b6g1e2e7e5d4d5c7c6b1c3c6d5e4d5e8g8.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2d7d5c4d5f6d5e2e4d5b6g1e2e7e5d4d5e8g8e1g1c7c6b1c3c6d5.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2d7d5c4d5f6d5g1f3e8g8e1g1c7c5d4c5b8a6f3g5d5b4a2a3d8d1.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2d7d5c4d5f6d5g1f3e8g8e1g1c7c5e2e4d5f6e4e5f6d5d4c5d5b4.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2d7d5g1f3e8g8e1g1d5c4b1a3c4c3b2c3c7c5e2e3b8c6d1e2f6d5.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2d7d6b1c3e8g8g1f3b8d7e1g1e7e5b2b3f8e8d1c2f6g4d4e5d7e5.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3c7c5d4d5d7d6g1f3b8a6f3d2a6c7d1c2a8b8b2b3e7e6.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3c7c5d4d5e7e5c1g5h7h6g5f6d8f6d5d6b8c6e2e3b7b6.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3c7c5d4d5e7e5g1f3d7d6e1g1b8d7d1c2d8e7e2e4a7a6.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6e2e3b8d7g1e2a7a6b2b3a8b8a2a4a6a5c1a3c7c6.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6e2e3b8d7g1e2a7a6b2b3a8b8a2a4e7e5c1a3b7b6.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6e2e3b8d7g1e2e7e5b2b3f8e8c1a3a8b8e1g1a7a6.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6e2e3b8d7g1e2e7e5b2b3f8e8c1a3h7h5h2h3a7a6.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6g1f3b8c6e1g1a7a6d4d5c6a5f3d2c7c5d1c2a8b8.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6g1f3b8c6e1g1e7e5d4d5c6e7c4c5f6d7c5d6c7d6.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6g1f3b8c6e1g1e7e5d4d5c6e7e2e4f6e8f3e1f7f5.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6g1f3b8c6e1g1e7e5d4e5c6e5f3e5d6e5d1d8f8d8.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6g1f3b8d7e1g1e7e5b2b3f8e8d1c2c7c6f1d1e5e4.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6g1f3b8d7e1g1e7e5e2e4c7c6c1e3f6g4e3g5d8b6.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6g1f3b8d7e1g1e7e5e2e4c7c6h2h3e5d4f3d4f8e8.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6g1f3b8d7e1g1e7e5e2e4e5d4f3d4d7c5h2h3f8e8.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6g1f3b8d7e1g1e7e5e2e4e5d4f3d4f8e8h2h3d7c5.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6g1f3b8d7e1g1e7e5e2e4f8e8d4d5a7a5f3e1d7c5.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6g1f3b8d7e1g1e7e5e2e4f8e8d4d5a7a6f3e1a8b8.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6g1f3b8d7e1g1e7e5e2e4f8e8h2h3e5d4f3d4d7c5.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6g1f3b8d7e1g1e7e5e2e4f8e8h2h3e5d4f3d4d7c5.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6g1f3b8d7e1g1e7e5e2e4f8e8h2h3e5d4f3d4d7c5.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6g1f3c7c5d4d5b8a6e1g1a6c7e2e4a7a6a2a4a8b8.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6g1f3c7c5d4d5b8a6e1g1a6c7f3d2a8b8a2a4e7e6.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8b1c3d7d6g1f3c7c5d4d5b8a6f3d2a6c7d1c2a8b8b2b3b7b5.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8e2e4d7d6g1e2c7c6e1g1e7e5b1c3b8d7f2f3f8e8c1e3d8c7.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8g1f3d7d6e1g1b8c6b1c3c8g4c1e3f6d7d1d2e7e5d4e5g4f3.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8g1f3d7d6e1g1b8c6b1c3c8g4h2h3g4f3g2f3f6d7f3g2c6d4.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8g1f3d7d6e1g1b8c6d4d5c6a5f3d2c7c5b1c3e7e5a2a3b7b6.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8g1f3d7d6e1g1b8d7b1c3e7e5e2e4c7c6h2h3d8b6d4d5c6d5.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8g1f3d7d6e1g1b8d7b1c3e7e5e2e4f8e8h2h3e5d4f3d4d7c5.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8g1f3d7d6e1g1b8d7d1c2e7e5f1d1f8e8b1c3c7c6d4e5d6e5.
d2d4g8f6c2c4g7g6g2g3f8g7f1g2e8g8g1f3d7d6e1g1c7c5d4c5d6c5f3e5d8c7e5d3b8c6b1c3c8f5.
d2d4g8f6g1f3b7b6c2c4e7e6g2g3c8a6b2b3a6b7f1g2f8b4c1d2a7a5e1g1e8g8b1c3d7d5d1c2b8a6.
d2d4g8f6g1f3b7b6g2g3c8b7f1g2c7c5e1g1c5d4f3d4b7g2g1g2d7d5c2c4e7e6d1a4d8d7d4b5b8c6.
d2d4g8f6g1f3b7b6g2g3c8b7f1g2e7e6c2c4f8b4b1c3d7d6e1g1b4c3b2c3b8c6f3d2d6d5c4d5e6d5.
d2d4g8f6g1f3b7b6g2g3c8b7f1g2e7e6e1g1c7c5c2c3f8e7b2b3e8g8c1b2d7d5b1d2b8c6c3c4a8c8.
d2d4g8f6g1f3c7c5c2c3e7e6g2g3d7d5f1g2b8c6e1g1f8e7d4c5e7c5c1g5e8g8b1d2c5e7g5f6e7f6.
d2d4g8f6g1f3c7c5c2c3g7g6c1g5d8b6d1b3f6e4g5f4b8c6d4d5c6d8b1d2e4f6e2e4d7d6f1b5c8d7.
d2d4g8f6g1f3c7c5c2c4c5d4f3d4e7e5d4c2d7d5c4d5d8d5d1d5f6d5e2e4d5b4c2b4f8b4c1d2b4d2.
d2d4g8f6g1f3c7c5d4c5e7e6a2a3f8c5b2b4c5e7c1b2a7a5b4b5e8g8e2e3d7d6c2c4b8d7f1e2d7c5.
d2d4g8f6g1f3c7c5d4d5d7d6b1c3e7e6d5e6c8e6e2e4f8e7f1b5e6d7a2a4e8g8e1g1b8c6h2h3c6b4.
d2d4g8f6g1f3c7c5d4d5d7d6b1c3g7g6e2e4f8g7f1b5c8d7a2a4e8g8e1g1b8a6f1e1a6b4h2h3e7e6.
d2d4g8f6g1f3c7c5d4d5e7e6b1c3e6d5c3d5f6d5d1d5d7d6e2e4f8e7f1c4e8g8d5h5c8e6c4e6f7e6.
d2d4g8f6g1f3c7c5d4d5e7e6b1c3f6d5c3d5e6d5d1d5f8e7e2e4e8g8f1c4d7d6d5h5c8e6c4e6f7e6.
d2d4g8f6g1f3c7c5d4d5e7e6c2c4e6d5c4d5d7d6b1c3g7g6e2e4f8g7f1e2e8g8e1g1f8e8f3d2b8d7.
d2d4g8f6g1f3d7d5c2c4c7c6b1c3d5c4a2a4c8f5e2e3e7e6f1c4f8b4e1g1b8d7f3h4e8g8f2f3f5g6.
d2d4g8f6g1f3d7d5c2c4c7c6c4d5c6d5c1f4b8c6b1c3c8f5e2e3e7e6f1b5f6d7e1g1f8e7a1c1e8g8.
d2d4g8f6g1f3d7d5c2c4d5c4b1c3c7c6a2a4c8f5e2e3e7e6f1c4b8d7e1g1f8b4d1e2f5g6e3e4e8g8.
d2d4g8f6g1f3d7d5c2c4e7e6b1c3c7c5c4d5f6d5e2e4d5c3b2c3c5d4c3d4b8c6f1c4b7b5c4e2f8b4.
d2d4g8f6g1f3d7d5c2c4e7e6b1c3c7c5e2e3b8c6a2a3f6e4d1c2e4c3c2c3c5d4f3d4c6d4c3d4d5c4.
d2d4g8f6g1f3d7d5c2c4e7e6b1c3f8e7c1g5b8d7e2e3e8g8a1c1b7b6c4d5e6d5d1a4c7c5a4c6a8b8.
d2d4g8f6g1f3d7d5c2c4e7e6b1c3f8e7c1g5b8d7e2e3e8g8a1c1b7b6c4d5e6d5f1b5c8b7e1g1c7c6.
d2d4g8f6g1f3d7d5c2c4e7e6b1c3f8e7c1g5e8g8e2e3b8d7d1c2c7c5c4d5f6d5g5e7d8e7c3d5e6d5.
d2d4g8f6g1f3d7d5c2c4e7e6b1c3f8e7c1g5h7h6g5f6e7f6e2e3e8g8a1c1c7c6f1d3d5c4d3c4b8d7.
d2d4g8f6g1f3d7d5c2c4e7e6b1c3f8e7c1g5h7h6g5h4e8g8e2e3b7b6c4d5f6d5h4e7d8e7a1c1c8b7.
d2d4g8f6g1f3d7d5c2c4e7e6c4d5e6d5b1c3c7c6d1c2f8e7e2e4d5e4c3e4b8d7f3e5d7e5d4e5d8a5.
d2d4g8f6g1f3d7d5c2c4e7e6g2g3d5c4d1a4b8d7f1g2a7a6a4c4b7b5c4c6a8b8c1f4c8b7c6c7f8b4.
d2d4g8f6g1f3d7d5c2c4e7e6g2g3d5c4d1a4b8d7f1g2a7a6a4c4c7c5d4c5f8c5e1g1b7b5c4h4c8b7.
d2d4g8f6g1f3d7d5c2c4e7e6g2g3d5c4d1a4b8d7f1g2a7a6b1c3a8b8a4c4b7b5c4d3c8b7e1g1c7c5.
d2d4g8f6g1f3d7d5g2g3c7c6f1g2c8f5e1g1h7h6c2c4e7e6b1c3f8e7d1b3d8b6c4c5b6a6b3d1b8d7.
d2d4g8f6g1f3d7d6c2c4c8g4d1b3d8c8h2h3g4h5g2g4h5g6f1g2c7c6b1c3e7e6d4d5f8e7c1e3f6d7.
d2d4g8f6g1f3d7d6c2c4g7g6b1c3f8g7e2e4e8g8f1e2c7c5e1g1b8c6d4d5c6a5h2h3e7e5a2a3b7b6.
d2d4g8f6g1f3d7d6g2g3b8d7f1g2e7e5c2c4f8e7b1c3e8g8e1g1c7c6d1c2d8c7b2b3f8e8c1b2e7f8.
d2d4g8f6g1f3d7d6g2g3g7g6f1g2f8g7e1g1e8g8c2c4b8d7b1c3e7e5c1g5h7h6g5d2c7c6d1c1g8h7.
d2d4g8f6g1f3e7e6c1g5c7c5e2e3b7b6b1d2c5d4e3d4c8b7f1d3f8e7e1g1e8g8f1e1d7d6a2a4b8c6.
d2d4g8f6g1f3e7e6c1g5c7c5e2e3b7b6d4d5e6d5b1c3f8e7c3d5c8b7g5f6e7f6c2c3e8g8f1c4a7a6.
d2d4g8f6g1f3e7e6c1g5c7c5e2e3f8e7b1d2c5d4e3d4b7b6c2c3c8b7f1d3d7d6e1g1b8d7f1e1e8g8.
d2d4g8f6g1f3e7e6c1g5c7c5e2e3f8e7d4c5e7c5c2c4c5b4b1d2b7b6f1d3b8c6e1g1b4e7a1c1c8b7.
d2d4g8f6g1f3e7e6c1g5c7c5e2e3h7h6g5f6d8f6b1d2c5d4e3d4b8c6c2c3d7d5f1d3f8d6d1e2e8g8.
d2d4g8f6g1f3e7e6c1g5d7d5b1d2f8e7e2e3b8d7f1d3c7c5c2c3b7b6e1g1c8b7f3e5d7e5d4e5f6d7.
d2d4g8f6g1f3e7e6c2c4b7b6b1c3c8b7a2a3d7d5c4d5f6d5e2e3f8e7f1b5c7c6b5d3b8d7e1g1e8g8.
d2d4g8f6g1f3e7e6c2c4b7b6b1c3c8b7c1g5h7h6g5h4f8e7e2e3e8g8f1d3c7c5e1g1c5d4e3d4b7f3.
d2d4g8f6g1f3e7e6c2c4b7b6b1c3c8b7c1g5h7h6g5h4f8e7e2e3e8g8f1d3c7c5e1g1c5d4e3d4d7d5.
d2d4g8f6g1f3e7e6c2c4b7b6b1c3c8b7e2e3f8b4f1d3e8g8e1g1b4c3b2c3c7c5f1e1f6e4d1c2f7f5.
d2d4g8f6g1f3e7e6c2c4b7b6b1c3f8b4c1d2c7c5a2a3b4c3d2c3c8b7e2e3e8g8f1d3d7d6e1g1b8d7.
d2d4g8f6g1f3e7e6c2c4b7b6e2e3c8b7f1d3d7d5b2b3f8e7e1g1e8g8c1b2c7c5d1e2c5d4e3d4b8c6.
d2d4g8f6g1f3e7e6c2c4b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2c7c6f3e5d7d5d2c3f6d7e5d7b8d7.
d2d4g8f6g1f3e7e6c2c4b7b6g2g3c8a6b2b3f8b4c1d2b4e7f1g2d7d5c4d5e6d5e1g1e8g8b1c3a6b7.
d2d4g8f6g1f3e7e6c2c4b7b6g2g3c8a6d1b3b8c6b1d2f8b4d4d5b4d2c1d2c6a5b3a4f6e4d2a5b6a5.
d2d4g8f6g1f3e7e6c2c4b7b6g2g3c8b7f1g2f8e7b1c3e8g8e1g1f6e4c1d2d7d5f3e5b8d7c4d5e6d5.
d2d4g8f6g1f3e7e6c2c4b7b6g2g3c8b7f1g2f8e7b1c3e8g8e1g1f6e4c1d2f7f5d4d5e7f6d1c2f6c3.
d2d4g8f6g1f3e7e6c2c4c7c5e2e3d7d5b1c3b8c6c4d5e6d5f1e2c5d4e3d4f8d6c1g5c8e6e1g1h7h6.
d2d4g8f6g1f3e7e6c2c4d7d5b1c3b8d7c1g5f8e7e2e3e8g8a1c1c7c6a2a3f8e8f1d3d5c4d3c4f6d5.
d2d4g8f6g1f3e7e6c2c4d7d5b1c3b8d7e2e3a7a6c4c5c7c6b2b4d8c7c1b2e6e5d4e5d7e5f3e5c7e5.
d2d4g8f6g1f3e7e6c2c4d7d5b1c3c7c5c4d5f6d5e2e3b8c6f1d3f8e7e1g1e8g8a2a3c5d4e3d4e7f6.
d2d4g8f6g1f3e7e6c2c4d7d5b1c3c7c5c4d5f6d5e2e3b8c6f1d3f8e7e1g1e8g8a2a3c5d4e3d4e7f6.
d2d4g8f6g1f3e7e6c2c4d7d5b1c3c7c5c4d5f6d5e2e3b8c6f1d3f8e7e1g1e8g8a2a3c5d4e3d4e7f6.
d2d4g8f6g1f3e7e6c2c4d7d5b1c3c7c5c4d5f6d5e2e4d5c3b2c3c5d4c3d4f8b4c1d2b4d2d1d2e8g8.
d2d4g8f6g1f3e7e6c2c4d7d5b1c3c7c5c4d5f6d5e2e4d5c3b2c3c5d4c3d4f8b4c1d2b4d2d1d2e8g8.
d2d4g8f6g1f3e7e6c2c4d7d5b1c3d5c4e2e4f8b4c1g5c7c5f1c4c5d4f3d4b4c3b2c3d8a5c4b5c8d7.
d2d4g8f6g1f3e7e6c2c4d7d5b1c3f8e7c1g5e8g8e2e3b8d7f1d3d5c4d3c4c7c5e1g1a7a6a2a4c5d4.
d2d4g8f6g1f3e7e6c2c4d7d5c1g5h7h6g5f6d8f6b1c3c7c6e2e3b8d7f1d3f6d8e1g1f8e7d1e2e8g8.
d2d4g8f6g1f3e7e6c2c4f8b4b1d2b7b6a2a3b4d2c1d2h7h6g2g3c8b7f1g2e8g8e1g1d7d6b2b4b8d7.
d2d4g8f6g1f3e7e6c2c4f8b4b1d2b7b6e2e3c8b7a2a3b4d2d1d2e8g8b2b3f6e4d2c2f7f5f1d3d7d6.
d2d4g8f6g1f3e7e6c2c4f8b4b1d2e8g8a2a3b4d2c1d2b7b6d2g5c8b7e2e3d7d6f1d3b8d7e1g1h7h6.
d2d4g8f6g1f3e7e6c2c4f8b4c1d2a7a5g2g3d7d5d1c2c7c5f1g2c5d4d2b4a5b4c4d5e8g8f3d4d8b6.
d2d4g8f6g1f3e7e6e2e3b7b6f1d3c8b7e1g1d7d5b2b3f8d6c1b2e8g8c2c4c7c5c4d5e6d5b1c3b8d7.
d2d4g8f6g1f3e7e6e2e3b7b6f1d3c8b7e1g1d7d5c2c4d5c4d3c4a7a6d1e2b8d7f1d1c7c5a2a4f8d6.
d2d4g8f6g1f3e7e6e2e3c7c5f1d3b8c6e1g1f8e7b2b3b7b6a2a3c8b7c1b2a8c8b1d2e8g8d1e2f8e8.
d2d4g8f6g1f3e7e6e2e3c7c5f1d3d7d5d4c5f8c5a2a3e8g8b2b4c5e7b1d2a7a5b4b5b8d7c1b2d7c5.
d2d4g8f6g1f3e7e6g2g3b7b5f1g2c8b7e1g1c7c5c1g5f8e7c2c3b8a6e2e3a8b8b1d2e8g8a2a3f6e4.
d2d4g8f6g1f3e7e6g2g3b7b6f1g2c8b7c2c4f8e7b1c3e8g8d1c2c7c5d4d5e6d5f3g5b8c6c3d5g7g6.
d2d4g8f6g1f3e7e6g2g3b7b6f1g2c8b7c2c4f8e7b1c3e8g8d1d3d7d5c4d5f6d5c3d5e6d5e1g1b8d7.
d2d4g8f6g1f3e7e6g2g3b7b6f1g2c8b7c2c4f8e7b1c3e8g8d4d5e7b4c1d2c7c6d5c6d7c6d1c2c6c5.
d2d4g8f6g1f3e7e6g2g3b7b6f1g2c8b7c2c4f8e7b1c3f6e4c1d2d7d5c4d5e6d5d1a4b7c6a4b3e8g8.
d2d4g8f6g1f3e7e6g2g3b7b6f1g2c8b7c2c4f8e7b1c3f6e4c1d2d7d5c4d5e6d5d1a4d8d7a4d7b8d7.
d2d4g8f6g1f3e7e6g2g3b7b6f1g2c8b7c2c4f8e7e1g1e8g8b1c3f6e4c3e4b7e4f3e1e4g2e1g2d7d5.
d2d4g8f6g1f3e7e6g2g3b7b6f1g2c8b7e1g1f8e7c2c4e8g8b1c3f6e4c1d2f7f5d4d5e7f6a1c1b8a6.
d2d4g8f6g1f3e7e6g2g3b7b6f1g2c8b7e1g1f8e7c2c4e8g8b1c3f6e4c3e4b7e4f3e1d7d5c4d5e4g2.
d2d4g8f6g1f3e7e6g2g3c7c5f1g2d8c7e1g1c5d4f3d4a7a6d4b3f8e7c1f4d7d6c2c4b8d7b1a3f6h5.
d2d4g8f6g1f3g7g6b1c3d7d5c1f4f8g7e2e3c7c6f1e2b8d7f3e5a7a5h2h4h7h5d1d2f6e4c3e4d5e4.
d2d4g8f6g1f3g7g6c1f4f8g7b1d2c7c5c2c3c5d4c3d4d7d5f4b8a8b8d1a4c8d7a4a7f6e4e2e3e4d2.
d2d4g8f6g1f3g7g6c1f4f8g7b1d2d7d6h2h3e8g8e2e3c7c5f1e2b8c6f4h2b7b6e1g1c8b7c2c3d8d7.
d2d4g8f6g1f3g7g6c1f4f8g7b1d2d7d6h2h3e8g8e2e3c7c5f1e2b8c6f4h2c5d4e3d4c8d7e1g1a8c8.
d2d4g8f6g1f3g7g6c1f4f8g7e2e3d7d6h2h3e8g8f1e2b7b6e1g1c8b7c2c4f6e4d1c2b8d7b1c3e4c3.
d2d4g8f6g1f3g7g6c1g5f8g7b1d2d7d5e2e3e8g8c2c3b8d7f1e2f8e8b2b4c7c6e1g1e7e5d2b3d8b6.
d2d4g8f6g1f3g7g6c1g5f8g7c2c3d7d5b1d2e8g8e2e3c7c6f1e2c8g4e1g1b8d7b2b4a7a5b4b5a5a4.
d2d4g8f6g1f3g7g6c2c4f8g7b1c3d7d5c1f4e8g8a1c1c7c5d4c5d5c4d1d8f8d8e2e4b8a6e4e5f6g4.
d2d4g8f6g1f3g7g6c2c4f8g7b1c3d7d5d1b3d5c4b3c4e8g8e2e4a7a6c4a4b8d7e4e5f6g4h2h3g4h6.
d2d4g8f6g1f3g7g6c2c4f8g7b1c3d7d5e2e3e8g8g2g3d5c4f3e5c8e6f1g2d8c8d1e2c7c6e5c4e6h3.
d2d4g8f6g1f3g7g6c2c4f8g7b1c3d7d6c1g5h7h6g5h4g6g5h4g3f6h5e2e3e7e6f1d3d8e7a1c1e8g8.
d2d4g8f6g1f3g7g6c2c4f8g7b1c3e8g8e2e4d7d6f1e2e7e5c1e3c7c6e1g1e5d4e3d4d8e7f3d2f8e8.
d2d4g8f6g1f3g7g6c2c4f8g7b1c3e8g8e2e4d7d6f1e2e7e5e1g1b8c6d4d5c6e7b2b4f6h5f1e1h5f4.
d2d4g8f6g1f3g7g6c2c4f8g7b1c3e8g8e2e4d7d6f1e2e7e5e1g1e5d4f3d4b8d7c1g5d7c5f2f3h7h6.
d2d4g8f6g1f3g7g6c2c4f8g7b1c3e8g8e2e4d7d6f1e2e7e5e1g1e5d4f3d4f8e8f2f3c7c6g1h1a7a6.
d2d4g8f6g1f3g7g6c2c4f8g7g2g3c7c6f1g2d7d5c4d5c6d5b1c3e8g8f3e5e7e6e1g1f6d7e5f3b8c6.
d2d4g8f6g1f3g7g6c2c4f8g7g2g3c7c6f1g2d7d5c4d5c6d5e1g1e8g8b1c3f6e4c3e4d5e4f3e5f7f6.
d2d4g8f6g1f3g7g6c2c4f8g7g2g3d7d5c4d5f6d5f1g2d5b6e2e4e8g8e1g1c8g4d4d5d8d7b1c3c7c6.
d2d4g8f6g1f3g7g6c2c4f8g7g2g3d7d5f1g2d5c4e1g1c7c6b1c3e8g8h2h3b7b5f3e5a7a6e2e4c8b7.
d2d4g8f6g1f3g7g6c2c4f8g7g2g3e8g8f1g2d7d5c4d5f6d5e1g1b8c6e2e4d5b6d4d5c6a5d1e1a5c4.
d2d4g8f6g1f3g7g6c2c4f8g7g2g3e8g8f1g2d7d5c4d5f6d5e1g1d5b6b1c3b8c6d4d5c6a5c1f4c7c6.
d2d4g8f6g1f3g7g6c2c4f8g7g2g3e8g8f1g2d7d5c4d5f6d5e1g1d5b6b1c3b8c6e2e3e7e5d4d5c6a5.
d2d4g8f6g1f3g7g6c2c4f8g7g2g3e8g8f1g2d7d6e1g1b8c6b1c3a7a6h2h3e7e5d4d5c6e7e2e4b7b5.
d2d4g8f6g1f3g7g6c2c4f8g7g2g3e8g8f1g2d7d6e1g1b8d7b1c3e7e5e2e4a7a6a1b1b7b5c4b5a6b5.
d2d4g8f6g1f3g7g6c2c4f8g7g2g3e8g8f1g2d7d6e1g1b8d7b1c3e7e5e2e4a7a6f1e1e5d4f3d4f6g4.
d2d4g8f6g1f3g7g6c2c4f8g7g2g3e8g8f1g2d7d6e1g1b8d7d1c2e7e5f1d1f8e8b1c3e5d4f3d4c7c6.
d2d4g8f6g1f3g7g6g2g3d7d5f1g2e7e6c2c4f8g7c1g5c7c5e1g1d8b6b1c3c5d4f3d4f6e4c3e4d5e4.
d2d4g8f6g1f3g7g6g2g3d7d5f1g2f8g7e1g1c7c6b1d2e8g8c2c4f6e4e2e3e4d2f3d2d5c4d2c4c8e6.
d2d4g8f6g1f3g7g6g2g3d7d5f1g2f8g7e1g1e8g8c1f4c7c6b1d2d8b6d1c1c6c5d4c5b6c5d2b3c5b4.
d2d4g8f6g1f3g7g6g2g3f8g7c2c4d7d5f1g2d5c4e1g1c7c6b1c3e8g8h2h3b8a6e2e4b7b5d1e2c8b7.
d2d4g8f6g1f3g7g6g2g3f8g7f1g2e8g8e1g1c7c6c2c4d7d6b1c3d8b6b2b3e7e5d4e5d6e5d1c2f8e8.
d2d4g8f6g1f3g7g6g2g3f8g7f1g2e8g8e1g1d7d5c2c4d5c4b1a3b8c6a3c4c8e6b2b3d8c8f1e1f8d8.
d2d4g8f6g1f3g7g6g2g3f8g7f1g2e8g8e1g1d7d6b1d2b8c6c2c3e7e5d4e5d6e5d2b3d8e7c1e3f8d8.
d2d4g8f6g1f3g7g6g2g3f8g7f1g2e8g8e1g1d7d6b2b3e7e5d4e5d6e5c1b2e5e4d1d8f8d8f3g5c8f5.
d2d4g8f6g1f3g7g6g2g3f8g7f1g2e8g8e1g1d7d6b2b3e7e5d4e5f6g4c1b2b8c6c2c4f8e8b1c3g4e5.
d2d4g8f6g1f3g7g6g2g3f8g7f1g2e8g8e1g1d7d6c2c4b8c6b1c3a7a6f1e1c8d7e2e4d7g4c1e3f6d7.
d2d4g8f6g1f3g7g6g2g3f8g7f1g2e8g8e1g1d7d6c2c4b8c6b1c3a8b8c1d2c8g4d4d5g4f3e2f3c6e5.
d2d4g8f6g1f3g7g6g2g3f8g7f1g2e8g8e1g1d7d6f1e1b8d7e2e4e7e5c2c3f8e8b1d2b7b6d1c2c8b7.
e2e3e7e5b1c3d7d5d2d4e5d4d1d4g8f6e3e4b8c6f1b5c8d7b5c6d7c6e4e5f6e4c3e4d5e4g1e2f8e7.
e2e3e7e5d2d4e5d4e3d4d7d5b1c3g8f6c1g5f8e7f1d3e8g8g1e2b8c6e1g1f6e8g5e7c6e7d1d2c7c6.
e2e4c7c5b1c3b8c6f2f4e7e6g1f3d7d5f1b5c8d7e4d5c6d4b5d7d8d7f3e5d7d6d5e6d6e6e1g1e8c8.
e2e4c7c5b1c3b8c6f2f4e7e6g1f3d7d5f1b5g8e7e4d5e6d5f3e5a7a6b5c6e7c6e1g1f8e7d1f3c8e6.
e2e4c7c5b1c3b8c6f2f4e7e6g1f3d7d5f1b5g8e7e4d5e7d5f3e5c8d7b5c6d7c6e5c6b7c6e1g1f8e7.
e2e4c7c5b1c3b8c6f2f4g7g6g1f3f8g7f1b5c6d4e1g1a7a6b5d3d7d6f3d4c5d4c3e2g8f6g1h1f6d7.
e2e4c7c5b1c3b8c6g1e2d7d6d2d4c5d4e2d4e7e6c1e3g8f6d1d2f8e7f2f3a7a6e1c1e8g8g2g4c6d4.
e2e4c7c5b1c3b8c6g1e2e7e5c3d5g8e7e2c3e7d5c3d5f8e7g2g3d7d6f1g2h7h5h2h4c8e6d2d3e6d5.
e2e4c7c5b1c3b8c6g1e2e7e6g2g3d7d5e4d5e6d5f1g2d5d4c3d5g8f6e2f4f6d5f4d5f8d6e1g1e8g8.
e2e4c7c5b1c3b8c6g1f3g7g6f1b5f8g7e1g1d7d6d2d3c8d7a2a4g8f6h2h3e8g8c1e3e7e5f3d2d7e6.
e2e4c7c5b1c3b8c6g2g3g7g6f1g2f8g7d2d3b7b6g1e2d7d6e1g1c8b7f2f4f7f5g3g4f5g4f4f5d8d7.
e2e4c7c5b1c3b8c6g2g3g7g6f1g2f8g7d2d3b7b6g1h3c8b7e1g1d7d6f2f4h7h6f4f5g7c3b2c3g6g5.
e2e4c7c5b1c3b8c6g2g3g7g6f1g2f8g7d2d3d7d6c1e3a8b8d1d2b7b5g1f3b5b4c3d1c6d4f3h4e7e5.
e2e4c7c5b1c3b8c6g2g3g7g6f1g2f8g7d2d3d7d6f2f4e7e5g1f3g8e7e1g1e8g8c1e3c6d4d1d2e5f4.
e2e4c7c5b1c3b8c6g2g3g7g6f1g2f8g7d2d3d7d6f2f4e7e5g1h3e5f4c1f4g8e7e1g1h7h6a1b1e8g8.
e2e4c7c5b1c3b8c6g2g3g7g6f1g2f8g7d2d3d7d6g1e2c8d7c1e3c6d4h2h3d8c8d1d2a8b8g3g4b7b5.
e2e4c7c5b1c3b8c6g2g3g7g6f1g2f8g7d2d3d7d6g1e2e7e5c3d5g8e7c2c3e7d5e4d5c6e7e1g1e8g8.
e2e4c7c5b1c3b8c6g2g3g7g6f1g2f8g7d2d3d7d6g1h3g8f6e1g1c8g4f2f3g4h3g2h3e8g8c1e3f6e8.
e2e4c7c5b1c3b8c6g2g3g7g6f1g2f8g7d2d3e7e6c1e3d7d6f2f4g8e7g1f3c6d4e1g1c8d7d1d2d8a5.
e2e4c7c5b1c3b8c6g2g3g7g6f1g2f8g7d2d3e7e6c1e3d8a5d1d2d7d6f2f4g8e7g1f3c6d4e1g1f7f5.
e2e4c7c5b1c3b8c6g2g3g7g6f1g2f8g7d2d3e7e6c1e3d8a5g1e2c6d4e1g1g8e7e3d2d7d6e2d4c5d4.
e2e4c7c5b1c3b8c6g2g3g7g6f1g2f8g7d2d3e7e6c1e3g8e7e3c5d7d6c5e3a7a6g1e2c8d7d1d2e8g8.
e2e4c7c5b1c3b8c6g2g3g7g6f1g2f8g7d2d3g8f6g1e2e8g8e1g1d7d6a1b1a8b8a2a3b7b5b2b4c5b4.
e2e4c7c5b1c3d7d6f2f4b8c6g1f3g7g6f1c4f8g7e1g1e7e6d2d3g8e7d1e1c6d4f3d4c5d4c3e2e8g8.
e2e4c7c5b1c3d7d6f2f4g7g6d2d4c5d4d1d4g8f6e4e5b8c6f1b5f6d7b5c6b7c6e5e6d7f6e6f7e8f7.
e2e4c7c5b1c3d7d6f2f4g7g6g1f3f8g7f1c4b8c6e1g1e7e6f4f5e6f5d2d3g8e7a2a3h7h6d1e1c8e6.
e2e4c7c5b1c3d7d6g1e2g8f6g2g3b8c6f1g2g7g6d2d3f8g7h2h3a8b8c1g5e8g8d1d2b7b5e1g1b5b4.
e2e4c7c5b1c3d7d6g1f3g8f6g2g3b8c6f1g2g7g6d2d4c5d4f3d4c6d4d1d4f8g7e1g1e8g8d4b4a7a5.
e2e4c7c5b1c3d7d6g2g3b8c6f1g2g7g6d2d3f8g7c1e3a8b8d1d2b7b5g1e2c6d4e1g1e7e6c3d1g8e7.
e2e4c7c5b1c3d7d6g2g3b8c6f1g2g7g6d2d3f8g7c1e3a8b8d1d2b7b5g1e2c6d4e1g1e7e6c3d1g8e7.
e2e4c7c5b1c3d7d6g2g3b8c6f1g2g7g6d2d3f8g7f2f4e7e6g1f3g8e7e1g1e8g8a1b1b7b6c1d2c8b7.
e2e4c7c5b1c3d7d6g2g3b8c6f1g2g7g6d2d3f8g7f2f4e7e6g1f3g8e7e1g1e8g8a2a3c8d7a1b1a8c8.
e2e4c7c5b1c3d7d6g2g3b8c6f1g2g7g6d2d3f8g7f2f4g8f6g1f3e8g8e1g1a8b8f3h4c6d4f4f5b7b5.
e2e4c7c5b1c3d7d6g2g3b8c6f1g2g7g6d2d3f8g7f2f4g8f6g1f3e8g8e1g1a8b8h2h3b7b5a2a3a7a5.
e2e4c7c5b1c3d7d6g2g3b8c6f1g2g7g6d2d3f8g7f2f4g8f6g1f3e8g8e1g1a8b8h2h3b7b5a2a3a7a5.
e2e4c7c5b1c3d7d6g2g3b8c6f1g2g7g6d2d3f8g7f2f4g8f6g1f3e8g8e1g1a8b8h2h3b7b5a2a3a7a5.
e2e4c7c5b1c3d7d6g2g3b8c6f1g2g7g6d2d3f8g7g1h3e7e6e1g1g8e7c1e3e8g8d1d2c6d4g1h1a8b8.
e2e4c7c5b1c3d7d6g2g3g7g6f1g2f8g7d2d3b8c6c1e3g8f6h2h3e8g8g1e2c8d7e1g1a7a6g3g4a8b8.
e2e4c7c5b1c3d7d6g2g3g7g6f1g2f8g7d2d3b8c6f2f4e7e6g1f3g8e7e1g1e8g8c1d2a8b8a1b1b7b5.
e2e4c7c5b1c3d7d6g2g3g7g6f1g2f8g7d2d3b8c6f2f4e7e6g1f3g8e7e1g1e8g8c1d2a8b8a1b1b7b5.
e2e4c7c5b1c3d7d6g2g3g7g6f1g2f8g7d2d3b8c6g1h3e7e6e1g1g8e7c1e3e8g8d1d2e6e5f2f4f7f5.
e2e4c7c5b1c3e7e6g1e2b8c6d2d4c5d4e2d4d7d6g2g3g8f6f1g2c8d7e1g1f8e7c1e3e8g8d1e2a7a6.
e2e4c7c5b1c3e7e6g1e2b8c6d2d4c5d4e2d4d8c7g2g3a7a6f1g2d7d6e1g1c8d7a2a4g8f6d4c6d7c6.
e2e4c7c5b1c3e7e6g1e2b8c6g2g3d7d5e4d5e6d5d2d3g8f6f1g2f8e7c1g5d5d4g5f6e7f6c3e4f6e7.
e2e4c7c5b1c3e7e6g1f3a7a6d2d4c5d4f3d4d7d6f1d3g8f6e1g1f8e7f2f4b8c6d4c6b7c6d1e2f6d7.
e2e4c7c5b1c3e7e6g1f3a7a6d2d4c5d4f3d4d7d6g2g3b7b6f1g2c8b7e1g1f8e7f2f4d8c7d1e2g8f6.
e2e4c7c5b1c3e7e6g1f3a7a6d2d4c5d4f3d4d7d6g2g3b8c6f1g2c8d7e1g1g8f6a2a4f8e7d4c6d7c6.
e2e4c7c5b1c3e7e6g1f3a7a6g2g3b7b5f1g2c8b7d2d4b5b4c3a4c5d4f3d4g8f6c1g5d8a5g5f6g7f6.
e2e4c7c5b1c3e7e6g1f3a7a6g2g3b7b5f1g2c8b7d2d4g8f6c1g5c5d4f3d4h7h6g5f6d8f6e1g1b8c6.
e2e4c7c5b1c3e7e6g1f3b8c6g2g3d7d5f1g2d5d4c3e2g7g6d2d3f8g7e1g1g8e7f3h4e6e5f2f4d8d6.
e2e4c7c5b1c3e7e6g1f3d7d6d2d4c5d4f3d4g8f6f1e2a7a6e1g1d8c7c1e3b7b5a2a3c8b7f2f3b8d7.
e2e4c7c5b1c3e7e6g1f3d7d6d2d4c5d4f3d4g8f6g2g3f8e7f1g2e8g8e1g1a7a6a2a4d8c7h2h3b8c6.
e2e4c7c5b1c3e7e6g2g3d7d5e4d5e6d5f1g2g8f6g1e2d5d4c3e4f6e4g2e4b8d7d2d3d7f6e4g2f8d6.
e2e4c7c5b1c3g7g6g2g3f8g7d2d3b8c6f1g2a8b8f2f4d7d6g1f3e7e6e1g1g8e7e4e5d6e5f4e5c6e5.
e2e4c7c5c2c3d7d5e4d5d8d5d2d4e7e6g1f3b8c6f1e2g8f6e1g1f8e7c1e3c5d4f3d4c6d4e3d4e8g8.
e2e4c7c5c2c3d7d5e4d5d8d5d2d4e7e6g1f3g8f6c1e3c5d4c3d4f8e7b1c3d5d6f1d3b8c6a2a3e8g8.
e2e4c7c5c2c3d7d5e4d5d8d5d2d4g8f6g1f3b8c6c1e3c5d4c3d4e7e6b1c3d5d6a2a3f8e7f1d3e8g8.
e2e4c7c5c2c3d7d5e4d5d8d5d2d4g8f6g1f3c8g4d4c5d5c5b1a3a7a6c1e3c5c7h2h3g4h5d1a4b8d7.
e2e4c7c5c2c3d7d5e4d5d8d5d2d4g8f6g1f3c8g4f1e2e7e6e1g1b8c6c1e3c5d4c3d4f8b4a2a3b4a5.
e2e4c7c5c2c3d7d5e4d5d8d5d2d4g8f6g1f3c8g4f1e2e7e6h2h3g4h5e1g1b8c6c1e3c5d4c3d4f8b4.
e2e4c7c5c2c3d7d6d2d4g8f6f1d3c5d4c3d4g7g6b1c3f8g7h2h3e8g8g1f3e7e5d4e5d6e5e1g1b8c6.
e2e4c7c5c2c3e7e6d2d4d7d5e4d5e6d5c1e3c5c4b2b3c4b3a2b3f8d6f1d3b8c6d1f3g8f6h2h3h7h6.
e2e4c7c5c2c3g8f6e4e5f6d5d2d4c5d4g1f3b8c6c3d4d7d6f1c4d5b6c4b5d6e5f3e5c8d7e5d7d8d7.
e2e4c7c5c2c3g8f6e4e5f6d5d2d4c5d4g1f3e7e6c3d4d7d6a2a3c8d7f1d3d7c6e1g1b8d7b2b4a7a6.
e2e4c7c5c2c3g8f6e4e5f6d5g1f3b8c6f1c4d5b6c4b3c5c4b3c2d8c7d1e2g7g5e5e6d7e6f3g5c7e5.
e2e4c7c5c2c3g8f6e4e5f6d5g1f3b8c6f1c4d5b6c4b3c5c4b3c2g7g6b1a3d7d6d1e2d6d5h2h3f8g7.
e2e4c7c5c2c3g8f6e4e5f6d5g1f3b8c6f1c4d5b6c4e2d7d6e5d6e7e6d2d4f8d6d4c5d6c5d1d8c6d8.
e2e4c7c5c2c3g8f6e4e5f6d5g1f3b8c6f1c4d5b6c4e2d7d6e5d6e7e6d2d4f8d6e1g1e8g8e2d3g7g6.
e2e4c7c5c2c3g8f6e4e5f6d5g2g3b8c6f1g2d8c7f2f4e7e6b1a3f8e7g1e2e8g8e1g1a7a6d2d3b7b6.
e2e4c7c5d2d3b8c6g1f3g7g6g2g3f8g7f1g2d7d6e1g1g8f6b1d2e8g8a2a4c8d7d2c4d8c8f1e1f6g4.
e2e4c7c5g1e2d7d6g2g3g7g6f1g2f8g7c2c3g8f6d2d4e8g8e1g1d8c7b1a3b8c6h2h3f8d8c1e3e7e5.
e2e4c7c5g1e2d7d6g2g3g7g6f1g2f8g7e1g1b8c6c2c3e7e5d2d3g8e7a2a3e8g8b2b4b7b6f2f4e5f4.
e2e4c7c5g1e2g8f6b1c3d7d6g2g3b8c6f1g2g7g6d2d3f8g7c1e3e8g8h2h3f6e8d1d2c6d4c3d1a8b8.
e2e4c7c5g1e2g8f6b1c3d7d6g2g3b8c6f1g2g7g6d2d4c5d4e2d4c6d4d1d4f8g7e1g1e8g8d4d3c8e6.
e2e4c7c5g1e2g8f6b1c3d7d6g2g3b8c6f1g2g7g6e1g1f8g7d2d3e8g8h2h3a8b8f2f4c8d7c1e3b7b5.
e2e4c7c5g1e2g8f6b1c3d7d6g2g3g7g6f1g2b8c6e1g1f8g7d2d4c5d4e2d4c8g4d4e2d8c8f2f3g4h3.
e2e4c7c5g1e2g8f6b1c3e7e6g2g3b8c6f1g2f8e7e1g1d7d6d2d3a7a6a2a3d8c7f2f4b7b5g1h1e8g8.
e2e4c7c5g1f3a7a6b1c3e7e6d2d4c5d4f3d4b7b5f1d3d8b6d4b3b6c7e1g1c8b7d1e2d7d6a2a4b5b4.
e2e4c7c5g1f3a7a6d2d4c5d4f3d4g8f6b1c3e7e5d4f3f8b4f3e5e8g8f1d3d7d5e1g1b4c3b2c3d5e4.
e2e4c7c5g1f3b8c6b1c3e7e5f1c4d7d6d2d3f8e7f3d2e7g5d2f1g5c1a1c1g8e7f1e3e8g8a2a3g8h8.
e2e4c7c5g1f3b8c6b1c3g7g6d2d4c5d4f3d4f8g7c1e3g8f6f1e2e8g8d1d2d7d5e4d5f6d5c3d5d8d5.
e2e4c7c5g1f3b8c6b1c3g7g6g2g3f8g7f1g2g8f6d2d3e8g8f3h4a8b8f2f4d7d6e1g1c8d7f4f5b7b5.
e2e4c7c5g1f3b8c6c2c3d7d5e4d5d8d5d2d4g8f6f1e2e7e6e1g1f8e7b1a3e8g8a3b5d5d8d4c5e7c5.
e2e4c7c5g1f3b8c6d2d4c5d4c2c3d4d3c3c4d7d6f1d3g8f6e1g1e7e6b1c3f8e7c1f4e6e5f4g5c8g4.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4d8b6d4b3e7e6f1d3g8f6e1g1f8e7c2c4c6e5b1c3d7d6c1e3b6c7.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4d8c7b1c3e7e6c1e3a7a6f1d3g8f6e1g1c6e5h2h3f8c5d1e2d7d6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4d8c7b1c3e7e6c1e3a7a6f1d3g8f6e1g1h7h5h2h3b7b5d4c6c7c6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4d8c7b1c3e7e6f1e2a7a6e1g1g8f6c1e3f8e7f2f4d7d6a2a4e8g8.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4d8c7b1c3e7e6f1e2a7a6e1g1g8f6c1e3f8e7g1h1e8g8f2f4d7d6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4d8c7b1c3e7e6f1e2a7a6f2f4c6d4d1d4b7b5c1e3c8b7e1g1a8c8.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4d8c7b1c3e7e6g2g3a7a6f1g2g8f6e1g1c6d4d1d4f8c5c1f4d7d6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4e7e5d4b5a7a6b5d6f8d6d1d6d8f6d6d1f6g6b1c3g8e7h2h4h7h5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4e7e5d4b5d7d6c2c4c8e6b1c3a7a6b5a3a8c8f1d3f8e7e1g1e7g5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4e7e5d4b5d7d6c2c4f8e7b1c3a7a6b5a3c8e6f1d3e7g5a3c2g5c1.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4e7e6b1c3d7d6c1e3g8f6f1c4a7a6c4b3d8c7f2f4f8e7d1f3e8g8.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4e7e6b1c3d7d6c1e3g8f6f2f4f8e7d1f3e8g8e1c1d8c7d4b5c7b8.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4e7e6b1c3d7d6g2g3c8d7f1g2c6d4d1d4d7c6e1g1g8f6f1d1f8e7.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4e7e6b1c3d8c7c1e3a7a6a2a3g8f6f2f4d7d6f1d3c6d4e3d4e6e5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4e7e6b1c3d8c7c1e3a7a6f1d3b7b5d4c6c7c6e1g1c8b7a2a3g8f6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4e7e6b1c3d8c7c1e3a7a6f1d3g8f6e1g1b7b5d1e2c8b7a1d1c6e5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4e7e6b1c3d8c7c1e3a7a6f1e2c6d4d1d4b7b5e1g1c8b7a1d1g8f6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4e7e6b1c3d8c7c1e3a7a6f1e2g8f6a2a3f8e7e1g1e8g8f2f4d7d6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4e7e6b1c3d8c7f1e2g8f6e1g1a7a6c1e3f8b4d4c6b7c6c3a4e8g8.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4e7e6b1c3d8c7g2g3a7a6f1g2g8f6e1g1f8e7b2b3e8g8c1b2c6d4.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4e7e6d4b5d7d6c1f4e6e5f4e3g8f6e3g5c8e6b1c3a7a6g5f6g7f6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4e7e6d4b5d7d6c1f4e6e5f4e3g8f6e3g5d8a5d1d2f6e4d2a5c6a5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4e7e6d4b5d7d6c2c4g8f6b5c3f8e7g2g3e8g8f1g2a7a6e1g1a8b8.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g7g6b1c3f8g7c1e3g8f6f1c4c6a5c4e2e8g8e1g1d7d6f2f4c8d7.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g7g6b1c3f8g7c1e3g8f6f1c4d7d6f2f3c6a5c4b3a5b3a2b3e8g8.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g7g6b1c3f8g7c1e3g8f6f1c4d8a5e1g1e8g8c4b3d7d6h2h3c8d7.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g7g6b1c3f8g7c1e3g8f6f1c4e8g8c4b3d8a5f2f3d7d5e4d5c6b4.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g7g6c2c4f8g7c1e3g8f6b1c3e8g8f1e2b7b6e1g1c8b7f2f3f6h5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g7g6c2c4f8g7c1e3g8f6b1c3f6g4d1g4c6d4g4d1d4e6d1d2d7d6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g7g6c2c4g8f6b1c3c6d4d1d4d7d6c1e3f8g7f2f3e8g8d4d2c8e6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g7g6c2c4g8f6b1c3c6d4d1d4d7d6c4c5f8g7f1b5c8d7b5d7d8d7.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g7g6c2c4g8f6b1c3c6d4d1d4d7d6f1e2f8g7c1e3e8g8d4d2c8e6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1e3f6g4f1b5g4e3f2e3c8d7b5c6b7c6e1g1e7e6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2a7a6e1c1c8d7f2f4b7b5d4f3b5b4.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2a7a6e1c1c8d7f2f4b7b5g5f6g7f6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2a7a6e1c1c8d7f2f4b7b5g5f6g7f6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2a7a6e1c1c8d7f2f4f8e7d4f3b7b5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2a7a6e1c1c8d7f2f4f8e7f1e2e8g8.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2a7a6e1c1c8d7f2f4h7h6g5h4f6e4.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2a7a6e1c1c8d7h2h3b7b5a2a3f8e7.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2a7a6e1c1h7h6g5e3c8d7f2f3b7b5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2a7a6e1c1h7h6g5e3c8d7f2f4a8c8.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2a7a6e1c1h7h6g5e3d8c7f2f3a8b8.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2a7a6e1c1h7h6g5e3f6g4d4c6b7c6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2a7a6e1c1h7h6g5e3f6g4d4c6b7c6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2a7a6e1c1h7h6g5e3f8e7f2f4c6d4.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2a7a6e1c1h7h6g5f4c8d7d4c6d7c6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2a7a6f1e2c8d7a1d1d8c7e1g1f8e7.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2f8e7e1c1c6d4d2d4e8g8f2f4h7h6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2f8e7e1c1e8g8d4b3a7a6g5f6g7f6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2f8e7e1c1e8g8f2f4c6d4d2d4d8a5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2f8e7e1c1e8g8f2f4c6d4d2d4h7h6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2f8e7e1c1e8g8f2f4e6e5d4c6b7c6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2f8e7e1c1e8g8f2f4h7h6g5h4e6e5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2f8e7e1c1e8g8f2f4h7h6g5h4f6e4.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2h7h6g5f6g7f6e1c1a7a6f1e2h6h5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d2h7h6g5f6g7f6e1c1a7a6f2f4c8d7.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6d1d3a7a6a1d1c8d7f1e2f8e7e1g1e8g8.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6f1e2f8e7e1g1e8g8d1d3h7h6g5c1g8h8.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6f1e2f8e7e1g1e8g8d4b5a7a6g5f6g7f6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6f2f4f8e7d1d2e8g8e1c1c6d4d2d4d8a5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6c1g5e7e6g2g3f8e7f1g2e8g8e1g1c6d4d1d4h7h6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6f1c4c8d7c1g5d8a5g5f6g7f6d4b3a5g5e1g1h8g8.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6f1c4c8d7c4b3g7g6f2f3c6a5c1g5f8g7d1d2h7h6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6f1c4d8b6d4e2e7e6e1g1f8e7c4b3e8g8g1h1c6a5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6f1c4e7e6c4b3f8e7e1g1e8g8c1e3c6a5f2f4b7b6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6f1c4e7e6e1g1a7a6c1e3d8c7c4b3c6a5f2f4b7b5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6f1c4e7e6e1g1a7a6c1e3d8c7c4b3f8e7f2f4c6a5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6f1e2e7e5d4b3f8e7e1g1e8g8c1e3c8e6e2f3a7a5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6f1e2e7e5d4b3f8e7e1g1e8g8c1e3c8e6e2f3c6a5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6f1e2e7e6c1e3a7a6e1g1d8c7d4b3f8e7f2f4e8g8.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6f1e2g7g6c1e3f8g7h2h4e8g8h4h5d6d5h5g6f7g6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6f1e2g7g6c1e3f8g7h2h4e8g8h4h5d6d5h5g6h7g6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6f1e2g7g6c1e3f8g7h2h4h7h5f2f3e8g8d1d2d6d5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6f1e2g7g6e1g1f8g7d4b3e8g8g1h1a7a6f2f4b7b5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3d7d6g2g3c8g4f2f3g4d7c1e3g7g6d1d2f8g7e1c1e8g8.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3e7e5d4b3f8b4f1d3d7d5e4d5f6d5c1d2d5c3b2c3b4d6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3e7e5d4b5d7d6c1g5a7a6b5a3b7b5g5f6g7f6c3d5f6f5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3e7e5d4b5d7d6c1g5a7a6b5a3b7b5g5f6g7f6c3d5f6f5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3e7e5d4b5d7d6c1g5a7a6g5f6g7f6b5a3d6d5c3d5f8a3.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3e7e5d4b5d7d6c3d5f6d5e4d5c6b8c2c4f8e7f1e2a7a6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3e7e5d4b5d7d6c3d5f6d5e4d5c6e7a2a4e7f5c2c3g7g6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3e7e5d4b5d7d6c3d5f6d5e4d5c6e7c2c3e7f5a2a4g7g6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3e7e5d4b5d7d6c3d5f6d5e4d5c6e7c2c4e7f5f1d3f8e7.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3e7e5d4b5h7h6b5d6f8d6d1d6d8e7d6e7e8e7c1e3d7d6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3e7e6d4b5d7d6c1f4e6e5f4g5a7a6b5a3b7b5c3d5f8e7.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3e7e6d4c6b7c6e4e5f6d5c3e4d8c7f2f4c7a5c1d2a5b6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3e7e6f1b5d8b6b5c6d7c6e1g1f8e7e4e5f6d5c3e4c6c5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3g7g6d4c6b7c6e4e5f6g8f1c4f8g7c1f4d8a5e1g1g7e5.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3g7g6d4c6d7c6d1d8e8d8f1c4d8e8a2a4e7e5f2f4c8e6.
e2e4c7c5g1f3b8c6d2d4c5d4f3d4g8f6b1c3g7g6f1c4d7d6d4c6b7c6e4e5f6g4e5e6f7f5e1g1f8g7.
e2e4c7c5g1f3b8c6f1b5g7g6b5c6b7c6e1g1f8g7f1e1f7f6c2c3g8h6d2d4c5d4c3d4e8g8b1c3d7d6.
e2e4c7c5g1f3b8c6f1b5g7g6c2c3g8f6e4e5f6d5e1g1f8g7d2d4c5d4c3d4e8g8b1c3d5c7b5a4d7d6.
e2e4c7c5g1f3b8c6f1b5g7g6e1g1f8g7b1c3d7d6d2d3c8d7c3d5e7e6d5e3g8e7c2c3e8g8d3d4c6d4.
e2e4c7c5g1f3b8c6f1b5g7g6e1g1f8g7f1e1g8f6c2c3a7a6b5c6d7c6h2h3e8g8d2d4c5d4c3d4c6c5.
e2e4c7c5g1f3b8c6f1b5g7g6e1g1f8g7f1e1g8f6c2c3e8g8h2h3e7e5b1a3d7d6b5c6b7c6d2d3a7a5.
e2e4c7c5g1f3d7d6b1c3b8c6d2d4c5d4f3d4g8f6c1g5e7e6d1d2a7a6e1c1c8d7f2f4f8e7d4f3b7b5.
e2e4c7c5g1f3d7d6b1c3e7e6d2d4c5d4f3d4g8f6c1e3f8e7f2f4b8c6d1f3e6e5d4c6b7c6f4e5d6e5.
e2e4c7c5g1f3d7d6b1c3g8f6e4e5d6e5f3e5b8d7e5c4e7e6b2b3f8e7c1b2e8g8d1f3a8b8a2a4b7b6.
e2e4c7c5g1f3d7d6b1c3g8f6e4e5d6e5f3e5e7e6g2g3b8d7e5c4d7b6d1e2b6c4e2c4c8d7f1g2d8c8.
e2e4c7c5g1f3d7d6c2c3g8f6d1c2b8c6d2d4c5d4c3d4d6d5e4e5f6e4b1c3c8f5c2b3e4c3b2c3d8d7.
e2e4c7c5g1f3d7d6c2c3g8f6f1e2g7g6e1g1f8g7e2b5b8c6d2d4c5d4c3d4a7a6b5e2d6d5e4e5f6e4.
e2e4c7c5g1f3d7d6c2c3g8f6f1e2g7g6e1g1f8g7e2b5b8c6d2d4e8g8d4d5c6a5f1e1e7e6b5f1e6d5.
e2e4c7c5g1f3d7d6c2c3g8f6f1e2g7g6e1g1f8g7e2b5c8d7b5d7d8d7f1e1e8g8d2d4b8a6e4e5d6e5.
e2e4c7c5g1f3d7d6d2d4c5d4d1d4b8c6f1b5a7a6b5c6b7c6e1g1e7e5d4d3f8e7f1d1g8f6c1g5e8g8.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4b8c6b1c3e7e6f1e2g8f6c1e3f8e7f2f4e8g8e1g1c8d7d4b3a7a5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6a2a4b8c6f1e2e7e5d4b3f8e7e1g1e8g8c1g5c8e6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6a2a4b8c6f1e2g7g6c1e3f8g7e1g1e8g8f2f4c8d7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1e3e7e5d4b3c8e6d1d2b8d7f2f3a8c8g2g4f8e7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1e3e7e5d4f3d8c7a2a4f8e7a4a5b8d7f3d2d7c5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1e3e7e5d4f3d8c7a2a4f8e7a4a5e8g8f1e2c8e6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1e3e7e5d4f3f8e7f1c4c8e6c4e6f7e6f3g5d8d7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1e3e7e6d1d2b7b5f2f3c8b7g2g4b8c6d4c6b7c6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1e3e7e6f1e2f8e7f2f4b8c6d1d2c6d4d2d4e8g8.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1e3e7e6f2f3b7b5g2g4h7h6d1d2b8d7e1c1c8b7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1e3e7e6f2f4b7b5d1f3c8b7f1d3b8d7g2g4d7c5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1e3e7e6g2g4h7h6d1e2b8c6e1c1c8d7f2f3a8c8.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5b8c6d1d2e7e6e1c1c8d7f2f4h7h6g5h4g7g5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5b8d7f1c4d8a5d1d2h7h6g5f6d7f6e1c1e7e6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6d1d3f8e7f1e2h7h6g5h4b8d7e1c1d8c7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4b7b5e4e5d6e5f4e5d8c7e5f6c7e5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4b7b5e4e5d6e5f4e5d8c7f1b5a6b5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4b8d7d1f3d8c7e1c1b7b5f1d3c8b7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4b8d7d1f3d8c7e1c1b7b5f1d3c8b7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4c8d7d1f3b8c6e1c1d8c7d4c6b7c6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4d8b6d1d2b6b2a1b1b2a3f4f5b8c6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4d8b6d1d2b6b2a1b1b2a3f4f5b8c6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4d8b6d1d2b6b2a1b1b2a3f4f5b8c6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4d8b6d1d2b6b2d4b3b2a3f1d3f8e7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4d8b6d1d2b6b2d4b3b2a3g5f6g7f6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4d8b6d1d2b6b2d4b3b2a3g5f6g7f6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4d8b6d1d2b6b2d4b3b2a3g5f6g7f6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4d8b6d1d2b6b2d4b3b8c6g5f6g7f6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4f8e7d1f3b8d7f1c4h7h6g5f6e7f6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4f8e7d1f3d8c7e1c1b8d7d1e1h7h6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4f8e7d1f3d8c7e1c1b8d7f1d3b7b5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4f8e7d1f3d8c7e1c1b8d7f1e2b7b5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4f8e7d1f3d8c7e1c1b8d7f4f5e6e5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4f8e7d1f3d8c7e1c1b8d7g2g4b7b5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4f8e7d1f3d8c7e1c1b8d7g2g4b7b5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4f8e7d1f3d8c7e1c1b8d7g2g4b7b5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4f8e7d1f3d8c7e1c1b8d7g2g4b7b5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4h7h6g5h4d8b6a2a3b8c6h4f2b6c7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6c1g5e7e6f2f4h7h6g5h4d8b6a2a3b8c6h4f2b6c7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1c4b8d7a2a4g7g6e1g1f8g7c1g5e8g8d1d2d7c5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1c4e7e6a2a3f8e7e1g1e8g8c4a2b7b5f2f4c8b7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1c4e7e6c4b3b7b5e1g1f8e7d1f3d8c7f3g3b8c6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1c4e7e6c4b3b7b5e1g1f8e7d1f3d8c7f3g3e8g8.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1c4e7e6c4b3b7b5e1g1f8e7d1f3d8c7f3g3e8g8.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1c4e7e6c4b3b7b5f2f3f8e7c1e3e8g8d1d2d8c7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1c4e7e6c4b3b7b5f2f4b5b4c3a4f6e4e1g1g7g6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1c4e7e6c4b3b8c6c1e3f8e7f2f4e8g8e1g1c6d4.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1c4e7e6c4b3b8c6f2f4f8e7c1e3e8g8d1f3c6d4.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1c4e7e6c4b3b8d7f2f4d7c5d1f3b7b5f4f5c8d7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1c4e7e6c4b3b8d7f2f4d7c5e4e5d6e5f4e5f6d7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1c4e7e6c4b3b8d7f2f4d7c5f4f5f8e7d1f3e8g8.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1c4e7e6c4b3f8e7f2f4e8g8d1f3d8c7e1g1b7b5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1d3g7g6h2h3f8g7c1e3b8c6e1g1e8g8f1e1c8d7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2d8c7c1g5b8d7e1g1e7e6e2h5c7c4d4e6c4e6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2d8c7e1g1e7e6f2f4b8c6c1e3f8e7d1e1c6d4.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e5d4b3c8e6e1g1b8d7a2a4f8e7f2f4d8c7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e5d4b3c8e6e1g1b8d7a2a4f8e7f2f4d8c7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e5d4b3c8e6e1g1b8d7c1e3f8e7f2f3d7b6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e5d4b3c8e6e1g1b8d7f2f4d8c7a2a4f8e7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e5d4b3c8e6e1g1b8d7f2f4d8c7f4f5e6c4.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e5d4b3c8e6e1g1f8e7f2f4e5f4c1f4e8g8.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e5d4b3c8e6f2f4d8c7f4f5e6c4e2f3a6a5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e5d4b3f8e7c1e3b8d7e1g1e8g8f2f3d8c7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e5d4b3f8e7c1e3c8e6e1g1b8d7f2f4a8c8.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e5d4b3f8e7c1g5b8d7a2a4b7b6c3d5c8b7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e5d4b3f8e7e1g1c8e6f2f4d8c7a2a4b8d7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e5d4b3f8e7e1g1c8e6f2f4d8c7a2a4b8d7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e5d4b3f8e7e1g1c8e6f2f4d8c7a2a4b8d7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e5d4b3f8e7e1g1c8e6f2f4d8c7a2a4b8d7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e5d4b3f8e7e1g1c8e6f2f4d8c7g2g4h7h6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e5d4b3f8e7e1g1e8g8c1e3c8e6f2f4e5f4.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e5d4b3f8e7e1g1e8g8c1e3d8c7a2a4c8e6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e5d4b3f8e7e1g1e8g8c1e3d8c7a2a4c8e6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e5d4b3f8e7e1g1e8g8c1e3f8e8d1d2d8c7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e6e1g1d8c7f2f4f8e7c1e3b8d7e2f3d7b6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e6e1g1f8e7a2a4b8c6c1e3e8g8f2f4d8c7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e6e1g1f8e7a2a4b8c6c1e3e8g8f2f4d8c7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e6e1g1f8e7a2a4b8c6c1e3e8g8f2f4d8c7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e6e1g1f8e7a2a4b8c6c1e3e8g8f2f4d8c7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e6e1g1f8e7a2a4b8c6c1e3e8g8f2f4d8c7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e6e1g1f8e7f2f4e8g8g1h1b8c6c1e3d8c7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e6e1g1f8e7f2f4e8g8g1h1d8c7a2a4b8c6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e6e1g1f8e7f2f4e8g8g1h1d8c7a2a4b8c6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e6e1g1f8e7f2f4e8g8g1h1d8c7a2a4b8c6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e6e1g1f8e7f2f4e8g8g1h1d8c7a2a4b8c6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e6e1g1f8e7f2f4e8g8g1h1d8c7a2a4b8c6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e6e1g1f8e7f2f4e8g8g1h1d8c7d1e1b7b5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e6e1g1f8e7f2f4e8g8g1h1d8c7e2f3b8c6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e6f2f4f8e7e1g1e8g8g1h1d8c7d1e1b7b5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f2f4b8d7f1e2g7g6e1g1f8g7a2a4e8g8g1h1d8c7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f2f4d8c7f1e2e7e5d4b3b7b5e1g1c8b7d1d3b8d7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f2f4d8c7f1e2e7e6e1g1f8e7a2a4b8c6c1e3e8g8.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f2f4d8c7f1e2e7e6e1g1f8e7g1h1e8g8a2a4b8c6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f2f4e7e5d4f3b8d7a2a4d8c7f1d3f8e7e1g1e8g8.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f2f4e7e5d4f3b8d7a2a4d8c7f1d3g7g6e1g1b7b6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f2f4e7e5d4f3b8d7a2a4f8e7f1c4e8g8d1e2d8a5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6f2f4e7e6c1e3b7b5d1f3c8b7f1d3b8d7a2a3d7c5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6g2g3e7e5d4e2c8e6f1g2b7b5a2a4b5b4c3d5f6d5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6g2g3e7e5d4e2c8e6f1g2b7b5e1g1b8d7a2a4b5b4.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6g2g3e7e5d4e2c8g4f1g2d8d7h2h3g4e6c3d5e6d5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6g2g3e7e5d4e2f8e7f1g2e8g8a2a4b7b6e1g1c8b7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6g2g3e7e5d4e2f8e7f1g2e8g8a2a4b8c6e1g1c6b4.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3a7a6g2g3e7e6f1g2f8e7e1g1e8g8b2b3d8c7c1b2b8c6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6c1g5d8b6d4b3e7e6d1d2f8e7f2f3e8g8g2g4f8d8.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6c1g5e7e6d1d2a7a6e1c1c6d4d2d4f8e7f2f3d8c7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6c1g5e7e6d1d2a7a6e1c1c8d7f2f3d8c7c1b1f8e7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6c1g5e7e6d1d2a7a6e1c1c8d7f2f4b7b5d4c6d7c6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6c1g5e7e6d1d2a7a6e1c1c8d7f2f4b7b5d4c6d7c6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6c1g5e7e6d1d2a7a6e1c1f8e7f2f4c8d7d4f3b7b5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6c1g5e7e6d1d2a7a6e1c1f8e7g5f6g7f6f1c4c6d4.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6c1g5e7e6d1d2a7a6e1c1h7h6g5e3c6d4e3d4b7b5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6c1g5e7e6d1d2a7a6e1c1h7h6g5e3c6d4e3d4b7b5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6c1g5e7e6d1d2f8e7e1c1e8g8d4b3a7a5a2a4d6d5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6c1g5e7e6d1d2f8e7e1c1e8g8d4b3a7a5a2a4d6d5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6c1g5e7e6d1d2f8e7e1c1e8g8d4b3a7a6g5f6g7f6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6c1g5e7e6d1d2f8e7e1c1e8g8f2f4c6d4d2d4d8a5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6c1g5e7e6d1d2f8e7e1c1e8g8f2f4c6d4d2d4d8a5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6c1g5e7e6d1d2f8e7e1c1e8g8f2f4c6d4d2d4d8a5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6c1g5e7e6d1d2f8e7e1c1e8g8f2f4h7h6g5h4e6e5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6c1g5e7e6d1d2f8e7e1c1e8g8f2f4h7h6g5h4e6e5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6f1c4e7e6c4b3a7a6f2f4f8e7c1e3d8c7e1g1b7b5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6f1c4e7e6c4b3f8e7c1e3e8g8e1g1a7a6f2f4c6d4.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6f1c4e7e6c4b3f8e7c1e3e8g8e1g1c8d7f2f4d8c8.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6f1c4e7e6c4b3f8e7c1e3e8g8f2f4c8d7e1g1a7a6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6f1c4e7e6c4b3f8e7e1g1c6d4d1d4e8g8f2f4b7b6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6f1c4e7e6c4b3f8e7e1g1e8g8c1e3a7a6f2f4d8c7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6f1c4e7e6c4b3f8e7e1g1e8g8f2f4c8d7g1h1a8c8.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6f1c4e7e6c4b3f8e7f2f4e8g8c1e3c6d4e3d4b7b5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8c6f1e2g7g6d4b3f8g7e1g1e8g8c1g5a7a6a2a4c8e6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3b8d7f1c4a7a6c1g5d8a5d1d2e7e6e1g1h7h6g5h4g7g5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3c8d7c1g5e7e6d4b5d7b5f1b5b8c6d1f3h7h6g5h4f8e7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3c8d7f1e2e7e6e1g1f8e7f2f4b8c6d4b3e8g8c1e3a8c8.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3e7e6f1e2a7a6e1g1b8d7f2f4b7b5e2f3c8b7a2a3d8c7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3e7e6f1e2f8e7e1g1b8c6f2f4e8g8g1h1c8d7d4b3a7a6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3e7e6f1e2f8e7e1g1e8g8c1e3b8c6f2f4e6e5d4b3e5f4.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3e7e6f1e2f8e7e1g1e8g8f2f4b8c6c1e3a7a6d1e1c6d4.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3e7e6f1e2f8e7e1g1e8g8f2f4b8c6c1e3e6e5d4b3a7a5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3e7e6f2f4a7a6d1f3d8b6d4b3b8c6f1d3f8e7c1e3b6c7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3e7e6f2f4a7a6f1e2f8e7e1g1d8c7d1e1e8g8e1g3b8c6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3e7e6g2g3b8c6f1g2c8d7e1g1f8e7c1e3c6e5a2a4a7a6.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3e7e6g2g4a7a6f1g2f6d7e1g1b8c6g1h1f8e7f2f4e8g8.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3e7e6g2g4a7a6g4g5f6d7a2a4b8c6c1e3d7e5f1e2c6d4.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3e7e6g2g4h7h6g4g5h6g5c1g5a7a6f1g2c8d7d1e2f8e7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3e7e6g2g4h7h6h2h3a7a6f1g2g7g5b2b3b8d7c1b2d7e5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3g7g6c1e3f8g7d1d2b8c6f2f3e8g8f1c4c8d7h2h4h7h5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3g7g6c1e3f8g7d1d2b8d7f2f3a7a6e1c1b7b5g2g4c8b7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3g7g6c1e3f8g7f1e2b8c6e1g1e8g8d4b3a7a6f2f3b7b5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3g7g6c1e3f8g7f2f3b8c6d1d2e8g8e1c1c8e6c1b1a8c8.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3g7g6c1e3f8g7f2f3b8c6d1d2e8g8f1c4c8d7h2h4a8c8.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3g7g6c1e3f8g7f2f3e8g8d1d2b8c6f1c4c8d7c4b3a8c8.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3g7g6c1e3f8g7f2f3e8g8d1d2b8c6f1c4c8d7c4b3a8c8.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3g7g6c1e3f8g7f2f3e8g8d1d2b8c6f1c4c8d7e1c1c6e5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3g7g6c1e3f8g7f2f3e8g8d1d2b8c6f1c4c8d7h2h4h7h5.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3g7g6c1e3f8g7f2f3e8g8d1d2b8c6g2g4c8e6e1c1c6d4.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3g7g6c1e3f8g7f2f3e8g8d1d2f8e8g2g4b8c6h2h4f6d7.
e2e4c7c5g1f3d7d6d2d4c5d4f3d4g8f6b1c3g7g6f1e2f8g7c1e3e8g8e1g1b8c6d1d2d6d5e4d5f6d5.
e2e4c7c5g1f3d7d6d2d4g8f6b1c3c5d4f3d4a7a6c1g5e7e6f2f4d8b6d1d3b6b2a1b1b2a3f4f5b8c6.
e2e4c7c5g1f3d7d6d2d4g8f6b1c3c5d4f3d4a7a6f1c4e7e6a2a4f8e7e1g1e8g8c1e3b7b6f2f4d8c7.
e2e4c7c5g1f3d7d6d2d4g8f6b1c3c5d4f3d4e7e6f1e2a7a6a2a4b7b6e1g1c8b7e2d3b8d7d1e2f8e7.
e2e4c7c5g1f3d7d6f1b5b8c6d2d4c5d4d1d4c8g4d4d3a8c8c2c4g7g6b1c3f8g7e1g1g4f3d3f3g8f6.
e2e4c7c5g1f3d7d6f1b5b8c6e1g1c8d7f1e1g8f6c2c3a7a6b5f1d7g4d2d3g7g6b1d2f8g7h2h3g4d7.
e2e4c7c5g1f3d7d6f1b5b8c6e1g1c8d7f1e1g8f6c2c3a7a6b5f1d7g4d2d3g7g6b1d2f8g7h2h3g4f3.
e2e4c7c5g1f3d7d6f1b5b8c6e1g1c8g4h2h3g4h5c2c3d8b6b1a3a7a6b5a4b6c7d2d4b7b5a3b5a6b5.
e2e4c7c5g1f3d7d6f1b5b8d7c2c3g8f6d1e2e7e6d2d4c5d4c3d4f8e7e1g1e8g8c1d2a7a6b5d3e6e5.
e2e4c7c5g1f3d7d6f1b5b8d7c2c3g8f6d2d3g7g6e1g1f8g7f1e1a7a6b5a4b7b5a4c2e8g8a2a4c8b7.
e2e4c7c5g1f3d7d6f1b5c8d7b5d7b8d7e1g1g8f6d1e2e7e6b2b3f8e7c1b2e8g8c2c4a7a6d2d4c5d4.
e2e4c7c5g1f3d7d6f1b5c8d7b5d7b8d7e1g1g8f6d1e2e7e6b2b3f8e7c1b2e8g8d2d4c5d4f3d4d7c5.
e2e4c7c5g1f3d7d6f1b5c8d7b5d7b8d7e1g1g8f6d1e2e7e6b2b3g7g6d2d4c5d4f3d4f8g7c1a3d8b6.
e2e4c7c5g1f3d7d6f1b5c8d7b5d7d8d7c2c4b8c6b1c3g8f6e1g1g7g6d2d4c5d4f3d4f8g7d4c2e8g8.
e2e4c7c5g1f3d7d6f1b5c8d7b5d7d8d7c2c4e7e5b1c3b8c6d2d3g7g6a2a3f8g7a1b1g8e7b2b4b7b6.
e2e4c7c5g1f3d7d6f1b5c8d7b5d7d8d7c2c4g8f6b1c3b8c6e1g1g7g6d2d4c5d4f3d4f8g7d4e2e8g8.
e2e4c7c5g1f3d7d6f1b5c8d7b5d7d8d7c2c4g8f6b1c3b8c6e1g1g7g6d2d4c5d4f3d4f8g7d4e2e8g8.
e2e4c7c5g1f3d7d6f1b5c8d7b5d7d8d7e1g1b8c6c2c3g8f6d2d4f6e4d4d5c6e5f1e1e5f3d1f3e4f6.
e2e4c7c5g1f3d7d6f1b5c8d7b5d7d8d7e1g1b8c6c2c4c6e5d2d3g7g6f3e5d6e5c1e3e7e6b1c3f8d6.
e2e4c7c5g1f3d7d6f1b5c8d7b5d7d8d7e1g1b8c6f1e1g8f6d2d4c5d4c1g5d6d5g5f6g7f6e4d5d7d5.
e2e4c7c5g1f3d7d6f1b5c8d7b5d7d8d7e1g1g8f6f1e1b8c6c2c3e7e6d2d4c5d4c3d4d6d5e4e5f6e4.
e2e4c7c5g1f3d7d6f1b5c8d7b5d7d8d7e1g1g8f6f1e1b8c6d2d4c5d4c1g5f6g4f3d4h7h6g5h4g7g5.
e2e4c7c5g1f3d7d6f1c4g8f6d2d3e7e6c4b3b8c6c2c3g7g6e1g1f8g7f1e1e8g8d3d4c5d4c3d4e6e5.
e2e4c7c5g1f3d7d6g2g3b8c6f1g2g8f6b1c3g7g6e1g1f8g7d2d3e8g8c1g5h7h6g5d2e7e5a2a3c8e6.
e2e4c7c5g1f3d7d6g2g3e7e5f1g2g7g6e1g1f8g7c2c3b8c6d2d3g8e7a2a3e8g8b2b4c5b4a3b4b7b5.
e2e4c7c5g1f3e7e6b1c3a7a6d2d4c5d4f3d4d8c7f1d3b8c6c1e3g8f6e1g1b7b5d4c6c7c6a2a3f8c5.
e2e4c7c5g1f3e7e6b1c3d7d6d2d4c5d4d1d4b8c6f1b5c8d7d4d3a7a6b5c6d7c6c1f4e6e5f4e3g8f6.
e2e4c7c5g1f3e7e6b2b3b8c6c1b2d7d6g2g3g8f6d2d3f8e7f1g2e8g8e1g1f6d7f1e1e7f6c2c3b7b6.
e2e4c7c5g1f3e7e6c2c3g8f6e4e5f6d5d2d4c5d4c3d4f8e7a2a3b7b6f1d3c8a6e1g1e8g8f1e1a6d3.
e2e4c7c5g1f3e7e6d2d3d7d5b1d2b8c6g2g3g7g6f1g2f8g7e1g1g8e7f1e1e8g8c2c3b7b6d2f1c8b7.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4a7a6b1c3b7b5f1d3c8b7e1g1d8c7f1e1f8c5c1e3g8f6d4b5a6b5.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4a7a6b1c3b8c6c1e3g8f6f1d3d7d5e4d5e6d5e1g1f8d6d4c6b7c6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4a7a6b1c3d8c7a2a3b8c6c1e3g8f6f1e2b7b5f2f4c8b7e2f3d7d6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4a7a6b1c3d8c7f1d3b8c6c1e3g8f6e1g1b7b5d4b3f8e7f2f4d7d6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4a7a6b1c3d8c7f2f4b7b5a2a3c8b7d1f3g8f6f1d3f8c5d4b3c5e7.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4a7a6c2c4g8f6b1c3f8b4d1f3d8c7d4c2b4d6f1e2b8c6f3e3b7b6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4a7a6c2c4g8f6b1c3f8b4f1d3b8c6d4e2d8c7e1g1c6e5f2f4e5c4.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4a7a6c2c4g8f6f1d3b8c6d4c6d7c6e1g1e6e5d1c2f8c5b1d2c8e6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4a7a6f1d3b8c6d4c6b7c6e1g1d7d5b1d2g8f6b2b3f8b4c1b2a6a5.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4a7a6f1d3b8c6d4c6b7c6e1g1d7d5b1d2g8f6d1e2f8e7b2b3e8g8.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4a7a6f1d3b8c6d4c6b7c6e1g1d7d5b1d2g8f6d1e2f8e7f1e1e8g8.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4a7a6f1d3b8c6d4c6b7c6e1g1d7d5c2c4g8f6c4d5c6d5e4d5e6d5.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4a7a6f1d3b8c6d4c6d7c6e1g1e6e5b1d2d8c7a2a4g8f6d1f3f8c5.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4a7a6f1d3f8c5c1e3d7d6b1c3g8e7e1g1b8d7d1e2b7b5a2a4d8b6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4a7a6f1d3f8c5d4b3c5a7d1e2b8c6c1e3d7d6b1c3g8e7e1g1e6e5.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4a7a6f1d3f8c5d4b3c5a7e1g1b8c6d1g4g8f6g4g7h8g8g7h6c6e5.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4a7a6f1d3g8f6e1g1d7d6c2c4f8e7b1c3e8g8c1e3b8d7f2f4d7c5.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4a7a6f1d3g8f6e1g1d8c7b1d2f8c5d2b3c5e7f2f4d7d6d1f3e8g8.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4a7a6f1d3g8f6e1g1d8c7d1e2d7d6c2c4g7g6b1c3f8g7f1d1e8g8.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4a7a6f1d3g8f6e1g1d8c7f2f4f8c5c2c3b8c6g1h1d7d6d4b3c5a7.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3a7a6d4c6b7c6f1d3d7d5e1g1g8f6f1e1f8e7e4e5f6d7.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3a7a6f1e2d7d6c1e3f8e7f2f4g8f6d1d2c6d4d2d4b7b5.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3a7a6f1e2d7d6e1g1g8f6c1e3f8e7f2f4e8g8a2a4d8c7.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3a7a6g2g3d7d6f1g2c8d7e1g1g8f6b2b3f8e7c3e2a8c8.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3a7a6g2g3d7d6f1g2c8d7e1g1g8f6f1e1f8e7d4c6d7c6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3d7d6c1e3g8f6f1e2f8e7f2f4e8g8d1d2a7a6e1c1d6d5.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3d7d6c1e3g8f6f2f4f8e7d1e2e6e5d4f3a7a6e1c1d8a5.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3d7d6c1e3g8f6f2f4f8e7f1e2e8g8e1g1c8d7d4b3a7a6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3d7d6f1e2g8f6c1e3c8d7f2f4f8e7d4b3a7a6a2a4c6a5.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3d7d6f1e2g8f6c1e3c8d7f2f4f8e7d4b5d8b8g2g4a7a6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3d7d6f1e2g8f6c1e3c8d7f2f4f8e7d4b5d8b8g2g4a7a6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3d7d6f1e2g8f6c1e3f8e7e1g1c8d7d4b3a7a6f2f4b7b5.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3d7d6f1e2g8f6c1e3f8e7f2f4c8d7e1g1e8g8g1h1a7a6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3d7d6f1e2g8f6c1e3f8e7f2f4e8g8e1g1c8d7d4b3a7a6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3d7d6g2g3g8f6f1g2c8d7e1g1c6d4d1d4d8c7c3d1f8e7.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3d7d6g2g4h7h6h2h4a7a6f1g2f8e7c1e3c6d4d1d4e6e5.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3d8c7c1e3a7a6f1d3g8f6e1g1c6e5h2h3f8c5d1d2d7d6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3d8c7c1e3a7a6f1d3g8f6e1g1c6e5h2h3f8c5g1h1d7d6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3d8c7c1e3a7a6f1e2g8f6a2a3f8d6d1d2c6d4e3d4d6f4.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3d8c7c1e3g8f6f1d3c6d4e3d4f8c5d4c5c7c5d1e2d7d6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3d8c7f1e2a7a6e1g1g8f6c1e3f8b4c3a4b4e7d4c6b7c6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3d8c7f1e2a7a6e1g1g8f6g1h1f8b4c1g5b4c3g5f6g7f6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3d8c7f1e2b7b6c1e3c8b7d1d2c6d4e3d4a7a6a1d1g8f6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6b1c3d8c7g2g3d7d6f1g2c6d4d1d4g8f6c1g5f8e7e1c1c8d7.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6d4b5d7d6c1f4e6e5f4e3g8f6e3g5c8e6b1c3a7a6g5f6g7f6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6d4b5d7d6c2c4g8f6b1c3a7a6b5a3d6d5c4d5e6d5e4d5c6b4.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6d4b5d7d6c2c4g8f6b1c3a7a6b5a3d6d5e4d5e6d5c4d5c6b4.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6d4b5d7d6c2c4g8f6b1c3a7a6b5a3f8e7f1e2e8g8e1g1b7b6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6d4b5d7d6c2c4g8f6b1c3a7a6b5a3f8e7f1e2e8g8e1g1b7b6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6d4b5d7d6c2c4g8f6b1c3a7a6b5a3f8e7f1e2e8g8e1g1b7b6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6d4b5d7d6c2c4g8f6b1c3a7a6b5a3f8e7f1e2e8g8e1g1b7b6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6d4b5d7d6c2c4g8f6b1c3a7a6b5a3f8e7f1e2e8g8e1g1b7b6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6d4b5d7d6c2c4g8f6b1c3a7a6b5a3f8e7f1e2e8g8e1g1b7b6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6d4b5d7d6c2c4g8f6b5c3f8e7f1e2e8g8e1g1b7b6c1f4c8b7.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4b8c6d4b5g8f6b1c3f8b4a2a3b4c3b5c3d7d5e4d5e6d5f1d3e8g8.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3b8c6d4b5d7d6c1f4e6e5f4g5a7a6b5a3b7b5c3d5f8e7.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3b8c6d4b5d7d6c1f4e6e5f4g5a7a6b5a3b7b5g5f6g7f6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3b8c6d4b5d7d6c1f4e6e5f4g5a7a6b5a3b7b5g5f6g7f6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3b8c6d4b5f8b4a2a3b4c3b5c3d7d5e4d5e6d5f1d3d5d4.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3b8c6d4b5f8b4a2a3b4c3b5c3d7d5e4d5e6d5f1d3e8g8.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3b8c6d4b5f8b4a2a3b4c3b5c3d7d5e4d5e6d5f1d3e8g8.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3d7d6f1c4f8e7c1e3e8g8f2f4d6d5c4d3d5e4c3e4f6d5.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3d7d6f1c4f8e7e1g1a7a6c4b3b7b5f2f4e8g8f4f5b5b4.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3d7d6f1e2f8e7e1g1b8c6g1h1a7a6a2a4e8g8f2f4d8c7.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3d7d6f1e2f8e7e1g1e8g8f2f4b8c6c1e3c8d7d4b3a7a5.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3d7d6f1e2f8e7e1g1e8g8f2f4b8c6c1e3d8c7d4b5c7b8.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3d7d6f2f4a7a6d1f3d8b6d4b3b8c6c1e3b6c7f1d3b7b5.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3d7d6f2f4a7a6f1e2f8e7e1g1e8g8c1e3b8c6a2a4f8e8.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3d7d6f2f4a7a6f1e2f8e7e1g1e8g8c1e3d8c7d1e1f8e8.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3d7d6f2f4b8c6c1e3e6e5d4f3f6g4d1d2g4e3d2e3e5f4.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3d7d6f2f4f8e7f1d3b8c6d4f3a7a6a2a3b7b5e1g1c8b7.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3d7d6g2g3a7a6f1g2d8c7e1g1c8d7g1h1b8c6f2f4a8c8.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3d7d6g2g4h7h6g4g5h6g5c1g5b8c6d1d2a7a6e1c1c8d7.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3d7d6g2g4h7h6g4g5h6g5c1g5b8c6d1d2a7a6e1c1c8d7.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3d7d6g2g4h7h6h1g1f8e7c1e3b8c6d1f3a7a6e1c1d8c7.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3d7d6g2g4h7h6h2h4b8c6h1g1h6h5g4h5f6h5c1g5h5f6.
e2e4c7c5g1f3e7e6d2d4c5d4f3d4g8f6b1c3d7d6g2g4h7h6h2h4f8e7h1g1d6d5e4d5f6d5c3d5d8d5.
e2e4c7c5g1f3e7e6g2g3b7b6f1g2c8b7d2d3d7d6e1g1g8f6f1e1f8e7b1d2e8g8c2c3b8d7a2a3a8c8.
e2e4c7c5g1f3e7e6g2g3b8c6f1g2g8f6d2d3d7d5b1d2f8e7e1g1b7b5a2a4b5a4a1a4e8g8e4d5e6d5.
e2e4c7c5g1f3e7e6g2g3b8c6f1g2g8f6d2d3d7d5b1d2f8e7e1g1e8g8f1e1b7b5e4d5e6d5d2f1c8b7.
e2e4c7c5g1f3g7g6c2c4f8g7d2d4d7d6b1c3b8c6c1e3c8g4d4c5d6c5d1d8a8d8e3c5g7c3b2c3g8f6.
e2e4c7c5g1f3g7g6d2d4c5d4f3d4b8c6b1c3f8g7c1e3g8f6f1c4d8a5e1g1e8g8c4b3d7d6h2h3a5h5.
e2e4c7c5g1f3g7g6d2d4c5d4f3d4b8c6b1c3f8g7d4c6b7c6f1c4d8a5d1f3g8f6e1g1e8g8a1b1d7d6.
e2e4c7c5g1f3g7g6d2d4c5d4f3d4b8c6b1c3f8g7d4c6b7c6f1c4e7e6e1g1g8e7d1d6c8b7c1g5h7h6.
e2e4c7c5g1f3g7g6d2d4f8g7b1c3b8c6c1e3c5d4f3d4g8f6f1c4e8g8c4b3d7d6f2f3c6a5d1d2a5b3.
e2e4c7c5g1f3g7g6d2d4f8g7d4d5d7d6b1c3g8f6f1b5b8d7a2a4e8g8e1g1a7a6b5e2a8b8f1e1f6e8.
e2e4c7c5g1f3g7g6f1c4b8c6e1g1f8g7c2c3g8h6d2d4c5d4c3d4e8g8b1c3d7d6h2h3g8h8c1f4f7f6.
e2e4c7c6b1c3d7d5d1f3g8f6e4e5f6d7f3g3e7e6g1f3a7a6f1e2c6c5e1g1b8c6f1e1c6d4e2d1d4f5.
e2e4c7c6b1c3d7d5d2d4d5e4c3e4c8f5e4g3f5g6g1h3e7e6h3f4f8d6c2c3g8f6h2h4d8c7h4h5d6f4.
e2e4c7c6b1c3d7d5d2d4d5e4c3e4c8f5e4g3f5g6h2h4h7h6g1e2e7e5f2f4e5d4e2d4f8c5c1e3g8f6.
e2e4c7c6b1c3d7d5d2d4d5e4c3e4c8f5e4g3f5g6h2h4h7h6g1f3b8d7f1d3g6d3d1d3d8c7c1d2g8f6.
e2e4c7c6b1c3d7d5g1f3c8g4h2h3g4f3d1f3e7e6d2d3b8d7f1e2g7g6e1g1f8g7f3g3d8b6g1h1g8e7.
e2e4c7c6b1c3d7d5g1f3c8g4h2h3g4f3d1f3e7e6d2d4d8b6f1d3b6d4e4d5e6d5c1f4b8d7e1c1d4f6.
e2e4c7c6b1c3d7d5g1f3c8g4h2h3g4f3d1f3e7e6g2g3g8f6d2d3f8e7f1g2e8g8e1g1b8a6f3e2f6e8.
e2e4c7c6b1c3d7d5g1f3c8g4h2h3g4f3d1f3g8f6d2d3e7e6a2a3f8c5g2g4e8g8h3h4b8d7g4g5f6e8.
e2e4c7c6b1c3d7d5g1f3c8g4h2h3g4f3d1f3g8f6d2d3e7e6a2a3f8e7g2g4f6d7d3d4d7f8c1e3f8g6.
e2e4c7c6b1c3d7d5g1f3c8g4h2h3g4f3d1f3g8f6d2d3e7e6f1e2b8d7f3g3g7g6e1g1f8g7c1f4d8b6.
e2e4c7c6b1c3d7d5g1f3c8g4h2h3g4f3d1f3g8f6d2d3e7e6g2g3f8b4c1d2d5d4c3b1b4d2b1d2e6e5.
e2e4c7c6b1c3d7d5g1f3c8g4h2h3g4f3d1f3g8f6d2d3e7e6g2g3f8b4c1d2d5d4c3b1b4d2b1d2e6e5.
e2e4c7c6b1c3d7d5g1f3c8g4h2h3g4f3d1f3g8f6d2d3e7e6g2g3f8b4c1d2d5d4c3b1d8b6b2b3a7a5.
e2e4c7c6b1c3d7d5g1f3c8g4h2h3g4f3d1f3g8f6d2d3e7e6g2g3f8b4c1d2d5d4c3b1d8b6b2b3a7a5.
e2e4c7c6b1c3d7d5g1f3c8g4h2h3g4f3d1f3g8f6d2d3e7e6g2g3f8b4c1d2d5d4c3b1d8b6b2b3b8d7.
e2e4c7c6b1c3d7d5g1f3c8g4h2h3g4f3d1f3g8f6d2d4e7e6f1d3d5e4c3e4f6e4f3e4b8d7c2c3d7f6.
e2e4c7c6b1c3d7d5g1f3c8g4h2h3g4f3g2f3e7e6d2d4b8d7c1f4f8b4h3h4g8f6e4e5f6h5f4g5d8a5.
e2e4c7c6b1c3d7d5g1f3c8g4h2h3g4h5e4d5c6d5f1b5b8c6g2g4h5g6f3e5a8c8h3h4f7f6e5g6h7g6.
e2e4c7c6b1c3d7d5g1f3d5e4c3e4c8g4h2h3g4f3d1f3b8d7d2d4g8f6f1d3f6e4f3e4e7e6e1g1f8e7.
e2e4c7c6b1c3d7d5g1f3d5e4c3e4c8g4h2h3g4f3d1f3e7e6f1c4b8d7f3g3d7f6d2d3f6e4d3e4g8f6.
e2e4c7c6b1c3d7d5g1f3d5e4c3e4c8g4h2h3g4f3d1f3e7e6f1c4f8e7e1g1g8f6f1e1b8d7d2d3f6e4.
e2e4c7c6b1c3d7d5g1f3d5e4c3e4g8f6e4f6g7f6f1c4f8g7h2h3c8f5e1g1e7e6f1e1e8g8d2d4b8d7.
e2e4c7c6b1c3d7d5g1f3g7g6e4d5c6d5f1b5b8c6f3e5c8d7e5d7d8d7d1f3e7e6c3e2f8g7d2d4g8e7.
e2e4c7c6b1c3d7d5g1f3g8f6e4e5f6e4c3e2d8b6d2d4c6c5d4c5b6c5e2d4b8c6f1b5a7a6b5c6b7c6.
e2e4c7c6c2c4d7d5c4d5c6d5e4d5g8f6b1c3f6d5g1f3d5c3b2c3g7g6h2h4f8g7h4h5b8c6a1b1d8c7.
e2e4c7c6c2c4d7d5c4d5c6d5e4d5g8f6b1c3f6d5g1f3e7e6d2d4f8e7f1c4e8g8e1g1b8c6f1e1a7a6.
e2e4c7c6c2c4d7d5e4d5c6d5c4d5g8f6b1c3f6d5f1c4d5b6c4b3b8c6g1f3c8f5d2d4e7e6e1g1f8e7.
e2e4c7c6c2c4d7d5e4d5c6d5c4d5g8f6b1c3f6d5g1f3b8c6d2d4c8g4d1b3g4f3g2f3e7e6b3b7c6d4.
e2e4c7c6c2c4e7e5g1f3d7d6d2d4e5d4f3d4g8f6b1c3g7g6f1e2f8g7e1g1e8g8c1e3f8e8e2f3b8d7.
e2e4c7c6c2c4e7e6b1c3d7d5c4d5e6d5e4d5c6d5g1f3g8f6f1b5b8c6e1g1f8e7f3e5c8d7d2d4e8g8.
e2e4c7c6d2d3d7d5b1d2e7e5g1f3b8d7d3d4d5e4d2e4e5d4d1d4g8f6c1g5f8e7e1c1e8g8e4d6d8a5.
e2e4c7c6d2d3d7d5b1d2e7e5g1f3f8d6d1e2d8e7d3d4e5d4e4d5c6d5f3d4b8c6d2b3g8f6e2e7e8e7.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4b8d7e4g5d7f6g1f3e7e6d1d3f8d6f3e5g8h6c1d2a7a5a2a3d8c7.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4b8d7e4g5g8f6f1d3e7e6g1f3h7h6g5e6d8e7e1g1f7e6d3g6e8d8.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4b8d7e4g5g8f6f1d3h7h6g5e6d8b6e6f8d7f8g1f3c8g4c2c3f8d7.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4b8d7f1c4g8f6e4f6d7f6c2c3d8c7h2h3c8f5g1f3e7e6e1g1f8d6.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4b8d7f1c4g8f6e4g5e7e6d1e2d7b6c4b3h7h6g5f3a7a5c2c3c6c5.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4b8d7f1c4g8f6e4g5e7e6d1e2d7b6c4b3h7h6g5f3a7a5c2c3c6c5.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4b8d7f1c4g8f6e4g5e7e6d1e2d7b6c4b3h7h6g5f3a7a5c2c3c6c5.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4b8d7f1c4g8f6e4g5e7e6d1e2d7b6c4d3h7h6g5f3c6c5d4c5f8c5.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4b8d7g1f3g8f6e4f6d7f6c2c3c8g4f1e2e7e6h2h3g4h5f3e5h5e2.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4b8d7g1f3g8f6e4f6d7f6c2c3c8g4h2h3g4f3d1f3d8d5f1e2e7e6.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4b8d7g1f3g8f6e4f6d7f6c2c3c8g4h2h3g4f3d1f3e7e6f1c4f8e7.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4b8d7g1f3g8f6e4f6d7f6f1c4c8f5e1g1e7e6h2h3f8e7c2c3e8g8.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4b8d7g1f3g8f6e4f6d7f6f3e5c8e6f1e2g7g6e1g1f8g7c2c4e8g8.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4b8d7g1f3g8f6e4g3e7e6f1d3c6c5e1g1c5d4f3d4f8c5d4b3c5e7.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4c8f5e4g3f5g6f1c4e7e6g1e2f8d6h2h4h7h6e2f4d6f4c1f4g8f6.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4c8f5e4g3f5g6f1c4e7e6g1e2g8f6e2f4f8d6e1g1f6d5g3h5e8g8.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4c8f5e4g3f5g6f1c4e7e6g1e2g8f6e2f4f8d6f4g6h7g6c1g5b8d7.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4c8f5e4g3f5g6g1e2b8d7h2h4h7h6e2f4g6h7f1c4e7e5d1e2d8e7.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4c8f5e4g3f5g6g1e2e7e6h2h4h7h6e2f4g6h7f1c4g8f6d1e2f8d6.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4c8f5e4g3f5g6g1e2g8f6h2h4h7h6e2f4g6h7f1c4e7e6e1g1f8d6.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4c8f5e4g3f5g6g1f3b8d7f1d3e7e6e1g1g8f6c2c4f8d6b2b3e8g8.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4c8f5e4g3f5g6g1f3b8d7f1d3e7e6e1g1g8f6c2c4f8d6b2b3e8g8.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4c8f5e4g3f5g6g1f3b8d7f1d3g8f6e1g1e7e6f1e1f8e7c2c4e8g8.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4c8f5e4g3f5g6g1f3b8d7h2h4h7h6h4h5g6h7f1d3h7d3d1d3e7e6.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4c8f5e4g3f5g6g1f3e7e6h2h4h7h6f1d3g6d3d1d3g8f6c1e3f8d6.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4c8f5e4g3f5g6h2h4h7h6g1f3b8d7f1d3g6d3d1d3d8c7c1d2e7e6.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4c8f5e4g3f5g6h2h4h7h6g1f3b8d7h4h5g6h7f1d3h7d3d1d3d8c7.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4c8f5e4g3f5g6h2h4h7h6g1f3b8d7h4h5g6h7f1d3h7d3d1d3d8c7.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4c8f5e4g3f5g6h2h4h7h6g1f3b8d7h4h5g6h7f1d3h7d3d1d3d8c7.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4c8f5e4g3f5g6h2h4h7h6g1f3b8d7h4h5g6h7f1d3h7d3d1d3e7e6.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4c8f5e4g3f5g6h2h4h7h6g1f3b8d7h4h5g6h7f1d3h7d3d1d3e7e6.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4c8f5e4g3f5g6h2h4h7h6g1f3b8d7h4h5g6h7f1d3h7d3d1d3g8f6.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4c8f5e4g3f5g6h2h4h7h6h4h5g6h7g1f3b8d7f1d3h7d3d1d3g8f6.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4e7e6g1f3b8d7f1d3g8f6c2c3c6c5c1g5c5d4f3d4d8b6e4f6g7f6.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4g8f6e4f6e7f6f1c4f8d6d1e2d8e7e2e7e8e7g1e2c8e6c4e6f7e6.
e2e4c7c6d2d4d7d5b1c3d5e4c3e4g8f6e4f6g7f6c2c3c8f5g1e2b8d7e2g3f5g6h2h4h7h6h4h5g6h7.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4b8d7e4g5d7f6f1c4e7e6g1e2f8d6e1g1h7h6g5f3d8c7e2g3g8e7.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4b8d7e4g5g8f6f1d3e7e6g1f3f8d6d1e2h7h6g5e4f6e4e2e4d7f6.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4b8d7e4g5g8f6f1d3e7e6g1f3f8d6d1e2h7h6g5e4f6e4e2e4d7f6.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4b8d7e4g5g8f6f1d3e7e6g1f3f8d6d1e2h7h6g5e4f6e4e2e4d7f6.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4b8d7e4g5g8f6f1d3e7e6g1f3f8e7d1e2h7h6g5e4f6e4e2e4c6c5.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4b8d7e4g5g8f6f1d3g7g6g1f3f8g7e1g1e8g8f1e1h7h6g5e4f6e4.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4b8d7f1c4g8f6e4f6d7f6g1f3c8f5d1e2e7e6c1g5f8e7e1c1f5g4.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4b8d7f1c4g8f6e4g5e7e6d1e2d7b6c4b3h7h6g5f3a7a5a2a3g7g6.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4b8d7f1c4g8f6e4g5e7e6d1e2d7b6c4d3h7h6g5f3c6c5d4c5f8c5.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4b8d7f1c4g8f6e4g5e7e6d1e2d7b6c4d3h7h6g5f3c6c5d4c5f8c5.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4b8d7f1c4g8f6e4g5e7e6d1e2d7b6c4d3h7h6g5f3c6c5d4c5f8c5.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4b8d7f1c4g8f6e4g5e7e6d1e2d7b6c4d3h7h6g5f3c6c5d4c5f8c5.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4b8d7f1c4g8f6e4g5e7e6d1e2d7b6c4d3h7h6g5f3c6c5d4c5f8c5.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4b8d7g1f3g8f6e4f6d7f6f3e5c8e6f1e2g7g6e1g1f8g7c2c4e8g8.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4b8d7g1f3g8f6e4f6d7f6f3e5c8e6f1e2g7g6e1g1f8g7c2c4e8g8.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4b8d7g1f3g8f6e4f6d7f6f3e5f6d7c1e3d7e5d4e5c8f5d1d8a8d8.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4b8d7g1f3g8f6e4f6d7f6f3e5f6d7e5d3g7g6c1e3f8g7d1d2d7b6.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4b8d7g1f3g8f6e4f6d7f6g2g3c8g4f1g2e7e5d4e5d8d1e1d1e8c8.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4b8d7g1f3g8f6e4g3e7e6f1d3f8e7e1g1e8g8b2b3c6c5c1b2b7b6.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4b8d7g1f3g8f6e4g3e7e6f1d3f8e7e1g1e8g8d1e2c6c5f1d1d8c7.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4c8f5e4c5b7b6c5b3e7e6g1f3b8d7g2g3g8f6f1g2a8c8e1g1f8d6.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4c8f5e4c5b7b6c5b3e7e6g1f3f8d6g2g3g8e7f1g2h7h6d1e2b8d7.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4c8f5e4c5b7b6c5b3g8f6g1f3e7e6g2g3b8d7f1g2d8c7e1g1a8d8.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4c8f5e4g3f5g6h2h4h7h6g1f3b8d7h4h5g6h7f1d3h7d3d1d3e7e6.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4c8f5e4g3f5g6h2h4h7h6g1f3b8d7h4h5g6h7f1d3h7d3d1d3e7e6.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4c8f5e4g3f5g6h2h4h7h6h4h5g6h7g1f3b8d7f1d3h7d3d1d3g8f6.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4g8f6e4f6e7f6f1c4b8d7g1e2f8d6e1g1e8g8c1f4d7b6c4d3c8e6.
e2e4c7c6d2d4d7d5b1d2d5e4d2e4g8f6e4f6g7f6g1f3c8f5g2g3e7e6f1g2f8g7e1g1e8g8f3h4f5g6.
e2e4c7c6d2d4d7d5e4d5c6d5c2c4e7e6b1c3g8f6g1f3f8e7c4d5f6d5f1d3b8c6e1g1e8g8f1e1e7f6.
e2e4c7c6d2d4d7d5e4d5c6d5c2c4g8f6b1c3b8c6c4d5f6d5g1f3c8g4d1b3g4f3g2f3e7e6b3b7c6d4.
e2e4c7c6d2d4d7d5e4d5c6d5c2c4g8f6b1c3e7e6c1g5f8e7g1f3e8g8f1d3d5c4d3c4a7a6a2a4b8c6.
e2e4c7c6d2d4d7d5e4d5c6d5c2c4g8f6b1c3e7e6g1f3f8b4c4d5f6d5c1d2b8c6f1d3b4e7e1g1e8g8.
e2e4c7c6d2d4d7d5e4d5c6d5c2c4g8f6b1c3e7e6g1f3f8b4c4d5f6d5c1d2b8c6f1d3b4e7e1g1e8g8.
e2e4c7c6d2d4d7d5e4d5c6d5c2c4g8f6b1c3e7e6g1f3f8b4c4d5f6d5d1c2b8c6f1d3b4e7a2a3d5f6.
e2e4c7c6d2d4d7d5e4d5c6d5c2c4g8f6b1c3e7e6g1f3f8e7c4d5f6d5f1c4d5c3b2c3e8g8e1g1b8d7.
e2e4c7c6d2d4d7d5e4d5c6d5c2c4g8f6b1c3e7e6g1f3f8e7c4d5f6d5f1c4d5f6e1g1e8g8d1e2b8c6.
e2e4c7c6d2d4d7d5e4d5c6d5c2c4g8f6b1c3e7e6g1f3f8e7c4d5f6d5f1d3b8c6e1g1e8g8f1e1d5f6.
e2e4c7c6d2d4d7d5e4d5c6d5c2c4g8f6b1c3e7e6g1f3f8e7c4d5f6d5f1d3b8c6e1g1e8g8f1e1e7f6.
e2e4c7c6d2d4d7d5e4d5c6d5c2c4g8f6b1c3e7e6g1f3f8e7c4d5f6d5f1d3b8c6e1g1e8g8f1e1e7f6.
e2e4c7c6d2d4d7d5e4d5c6d5c2c4g8f6b1c3e7e6g1f3f8e7c4d5f6d5f1d3b8c6e1g1e8g8f1e1e7f6.
e2e4c7c6d2d4d7d5e4d5c6d5c2c4g8f6b1c3e7e6g1f3f8e7c4d5f6d5f1d3e8g8e1g1b8c6f1e1e7f6.
e2e4c7c6d2d4d7d5e4d5c6d5c2c4g8f6b1c3g7g6d1b3f8g7c4d5e8g8g2g3b8a6f1g2d8b6b3b6a7b6.
e2e4c7c6d2d4d7d5e4d5c6d5f1d3b8c6c2c3g8f6c1f4c8g4d1b3d8d7b1d2e7e6g1f3g4f3d2f3f8d6.
e2e4c7c6d2d4d7d5e4e5c6c5d4c5b8c6c1f4e7e6b1d2f8c5d2b3c5b6d1g4e8f8g1f3f7f5g4g3g8e7.
e2e4c7c6d2d4d7d5e4e5c6c5d4c5e7e6b1c3b8c6c1f4g8e7g1f3e7g6f4e3g6e5f3e5c6e5d1h5e5c6.
e2e4c7c6d2d4d7d5e4e5c6c5d4c5e7e6c1e3g8h6c2c3h6f5e3d4c8d7g1f3b8c6d1d2f7f6b2b4a7a5.
e2e4c7c6d2d4d7d5e4e5c6c5d4c5e7e6c1e3g8h6c2c3h6f5e3d4f5d4c3d4b7b6b2b4a7a5f1b5c8d7.
e2e4c7c6d2d4d7d5e4e5c6c5d4c5e7e6d1g4b8c6g1f3d8c7f1b5c8d7b5c6c7c6c1e3g8h6e3h6g7h6.
e2e4c7c6d2d4d7d5e4e5c6c5d4c5e7e6d1g4b8d7g1f3g8e7c1g5h7h6g5e7d8e7b1c3e7c5e1c1a7a6.
e2e4c7c6d2d4d7d5e4e5c6c5d4c5e7e6g1f3f8c5f1d3b8c6e1g1g8e7c1f4d8b6b1c3a7a6c3a4b6a7.
e2e4c7c6d2d4d7d5e4e5c6c5d4c5e7e6g1f3f8c5f1d3b8c6e1g1g8e7c1f4e7g6f4g3e8g8c2c4d5c4.
e2e4c7c6d2d4d7d5e4e5c8f5b1c3d8b6g2g4f5d7f1g2e7e6g1e2c6c5e1g1c5d4e2d4b8c6d4b3c6e5.
e2e4c7c6d2d4d7d5e4e5c8f5b1c3e7e6g2g4f5g6g1e2c6c5h2h4h7h5e2f4b8c6f4g6f7g6c3e2g8e7.
e2e4c7c6d2d4d7d5e4e5c8f5b1c3e7e6g2g4f5g6g1e2c6c5h2h4h7h6c1e3d8b6d1d2b8c6e1c1h6h5.
e2e4c7c6d2d4d7d5e4e5c8f5f1d3f5d3d1d3e7e6g1f3d8a5b1d2a5a6c2c4g8e7e1g1b8d7b2b3e7f5.
e2e4c7c6d2d4d7d5e4e5c8f5f1e2e7e6g1f3c6c5c2c3b8d7e1g1g8e7d4c5e7c6f3d4f5b1a1b1f8c5.
e2e4c7c6d2d4d7d5e4e5c8f5g1f3e7e6a2a3b8d7b1d2h7h6f1e2g8e7d2f1f5g6c2c3c6c5f1g3e7c6.
e2e4c7c6d2d4d7d5e4e5c8f5g1f3e7e6a2a3b8d7c2c4d5c4f1c4d7b6c4b3g8e7e1g1e7d5f1e1f8e7.
e2e4c7c6d2d4d7d5e4e5c8f5g1f3e7e6c2c3c6c5a2a3c5d4c3d4g8e7c1e3e7c6f1d3f5d3d1d3f8e7.
e2e4c7c6d2d4d7d5e4e5c8f5g1f3e7e6c2c3g8e7f3h4f5b1a1b1c6c5a2a3b8c6f1e2e7g6h4g6h7g6.
e2e4c7c6d2d4d7d5e4e5c8f5g1f3e7e6f1e2b8d7e1g1g8e7c2c3h7h6b1a3a7a6a3c2f5h7c2e1c6c5.
e2e4c7c6d2d4d7d5e4e5c8f5g1f3e7e6f1e2b8d7e1g1g8e7f3h4f5g6b1d2c6c5c2c3c5d4c3d4e7f5.
e2e4c7c6d2d4d7d5e4e5c8f5g1f3e7e6f1e2b8d7e1g1h7h6b2b3g8e7c2c4e7g6b1a3g6f4c1f4f8a3.
e2e4c7c6d2d4d7d5e4e5c8f5g1f3e7e6f1e2c6c5c1e3c5d4f3d4g8e7c2c4b8c6d1a4d5c4b1a3d8a5.
e2e4c7c6d2d4d7d5e4e5c8f5g1f3e7e6f1e2c6c5c1e3c5d4f3d4g8e7e1g1b8c6e2b5a7a6b5c6b7c6.
e2e4c7c6d2d4d7d5e4e5c8f5g1f3e7e6f1e2c6c5c1e3c5d4f3d4g8e7e3g5d8a5b1c3f5g6e1g1a7a6.
e2e4c7c6d2d4d7d5e4e5c8f5g1f3e7e6f1e2c6c5e1g1b8c6c2c3c5d4c3d4g8e7a2a3f5e4b1d2e7f5.
e2e4c7c6d2d4d7d5e4e5c8f5g1f3e7e6f1e2c6c5e1g1b8c6c2c3f5g4b1d2c5d4c3d4g8e7a2a3e7f5.
e2e4c7c6d2d4d7d5e4e5c8f5h2h4c6c5d4c5d8c7b1c3b8c6g1f3a8d8c3b5c7c8f3d4f5g4f2f3g4d7.
e2e4c7c6d2d4d7d5e4e5c8f5h2h4h7h5g1e2e7e6e2g3g7g6g3f5g6f5c2c4c6c5c4d5d8d5b1c3d5d4.
e2e4c7c6d2d4d7d5e4e5c8f5h2h4h7h6g1e2e7e6e2g3g8e7b1c3b8d7c1e3f5h7f1d3h7d3c2d3h6h5.
e2e4c7c6d2d4d7d5e4e5c8f5h2h4h7h6g2g4f5d7c2c3c6c5f1g2e7e6g1e2d7b5b1a3b5e2d1e2c5d4.
e2e4c7c6d2d4d7d5e4e5c8f5h2h4h7h6g2g4f5d7h4h5c6c5c2c3b8c6f1h3e7e6c1e3d8b6d1b3c5d4.
e2e4c7c6d2d4d7d5f2f3e7e6b1c3g8f6c1g5h7h6g5h4d8b6a2a3c6c5g1e2b8c6d4c5f8c5c3a4b6a5.
e2e4c7c6d2d4d7d6g1f3g8f6b1c3c8g4h2h3g4h5f1d3e7e6d1e2d6d5c1g5f8e7e4e5f6d7g5e7d8e7.
e2e4d7d5e4d5d8d5b1c3d5a5d2d4g8f6g1f3c7c6f3e5c8e6f1d3b8d7f2f4g7g6e1g1f8g7g1h1e6f5.
e2e4d7d5e4d5g8f6d2d4f6d5g1f3c8g4f1e2b8c6c2c4d5b6d4d5g4f3g2f3c6e5f3f4e5d7b1c3c7c6.
e2e4d7d5e4d5g8f6f1b5c8d7b5c4d7g4f2f3g4c8b1c3b8d7d2d4d7b6c4b3b6d5c3d5f6d5c2c4d5f6.
e2e4d7d5e4d5g8f6f1b5c8d7b5c4d7g4f2f3g4f5g2g4f5c8b1c3a7a6a2a4c7c6d5c6b8c6d2d3e7e5.
e2e4d7d5e4d5g8f6f1b5c8d7b5c4d7g4f2f3g4f5g2g4f5c8b1c3a7a6g4g5b7b5c4b3f6d7d2d4d7b6.
e2e4d7d5e4d5g8f6f1b5c8d7b5c4d7g4f2f3g4f5g2g4f5c8b1c3c7c6d5c6b8c6d2d3e7e5g4g5f6h5.
e2e4d7d6d2d4g7g6b1c3f8g7f1e2c7c6f2f4d8b6e4e5g8h6.
e2e4d7d6d2d4g7g6b1c3f8g7f2f4g8f6g1f3e8g8f1e2c7c5d4c5d8a5e1g1a5c5g1h1b8c6e2d3c8g4.
e2e4d7d6d2d4g7g6b1c3f8g7g1f3g8f6f1e2e8g8e1g1c7c6a2a4a7a5h2h3b8a6c1e3a6b4d1d2d8c7.
e2e4d7d6d2d4g7g6b1c3g8f6f2f4f8g7g1f3c7c5d4c5d8a5f1d3a5c5d1e2e8g8c1e3c5a5e1g1c8g4.
e2e4d7d6d2d4g7g6f1e2f8g7b1c3c7c6c1e3b7b5a2a3g8f6d1d2e8g8e3h6e7e5h6g7g8g7a1d1d8e7.
e2e4d7d6d2d4g7g6g1f3f8g7b1c3c7c6a2a4g8f6f1e2a7a5e1g1e8g8c1e3b8a6f3d2a6b4a1c1d6d5.
e2e4d7d6d2d4g7g6g1f3g8f6b1c3f8g7f1e2e8g8e1g1c7c6a2a4a7a5h2h3b8a6c1f4a6c7f1e1c7e6.
e2e4d7d6d2d4g8f6b1c3b8d7f2f4e7e5g1f3e5d4d1d4f8e7c1e3d7c5e1c1c5e6d4d2e8g8h2h3b7b6.
e2e4d7d6d2d4g8f6b1c3g7g6c1e3c7c6d1d2b8d7h2h3d8c7g2g3b7b5f1g2b5b4c3d1a8b8g1e2f8g7.
e2e4d7d6d2d4g8f6b1c3g7g6c1e3f8g7d1d2c7c6f2f3d8a5g2g4b7b5g1e2h7h5g4g5f6d7f1g2b5b4.
e2e4d7d6d2d4g8f6b1c3g7g6c1e3f8g7d1d2c7c6f2f3d8a5g2g4h7h5g4g5f6h7f3f4e8g8g1f3e7e5.
e2e4d7d6d2d4g8f6b1c3g7g6c1e3f8g7d1d2f6g4e3g5h7h6g5h4g4f6f2f4b7b6e1c1c8b7e4e5d6e5.
e2e4d7d6d2d4g8f6b1c3g7g6f2f4f8g7g1f3e8g8f1e2c7c5d4c5d8a5e1g1a5c5g1h1b8c6f3d2a7a5.
e2e4d7d6d2d4g8f6b1c3g7g6g1f3f8g7f1c4b8c6d4d5c6b8h2h3c7c6c4b3e8g8e1g1b7b6c1g5c8b7.
e2e4d7d6d2d4g8f6b1c3g7g6g1f3f8g7f1e2c7c6a2a4a7a5e1g1e8g8h2h3b8a6f1e1d8c7c1g5h7h6.
e2e4d7d6d2d4g8f6b1c3g7g6g1f3f8g7f1e2c7c6e1g1e8g8a2a4b8d7a4a5d8c7h2h3f8d8c1e3d7f8.
e2e4d7d6d2d4g8f6b1c3g7g6g1f3f8g7f1e2c8g4e1g1e8g8h2h3g4f3e2f3b8c6c3e2e7e5c2c3f8e8.
e2e4d7d6d2d4g8f6b1c3g7g6g1f3f8g7f1e2e8g8e1g1c7c5d4d5b8a6c1f4a6c7a2a4b7b6f1e1c8b7.
e2e4d7d6d2d4g8f6b1c3g7g6g1f3f8g7f1e2e8g8e1g1c7c6h2h3b8d7c1f4d8a5d1d2e7e5f4e3f8e8.
e2e4d7d6d2d4g8f6b1c3g7g6g1f3f8g7f1e2e8g8e1g1c8g4c1e3b8c6d1d3e7e5d4d5c6b4d3d2a7a5.
e2e4d7d6d2d4g8f6b1c3g7g6g1f3f8g7h2h3e8g8c1e3b7b6f1c4e7e6e1g1c8b7d4d5e6d5e4d5a7a6.
e2e4d7d6d2d4g8f6b1c3g7g6g1f3f8g7h2h3e8g8c1e3c7c6a2a4b8d7a4a5d8c7f1e2e7e5d4e5d7e5.
e2e4d7d6d2d4g8f6b1c3g7g6g1f3f8g7h2h3e8g8c1e3c7c6d1d2b7b5f1d3b8d7e3h6e7e5h6g7g8g7.
e2e4d7d6d2d4g8f6b1c3g7g6g2g3f8g7f1g2e8g8g1e2b8d7e1g1c7c5h2h3a7a6c1e3d8c7d1d2c5d4.
e2e4e7e5b1c3b8c6f1c4g8f6d2d3c6a5c4b3a5b3a2b3d7d5e4d5f8b4g1f3f6d5c1d2d5c3b2c3b4d6.
e2e4e7e5b1c3b8c6f1c4g8f6d2d3c6a5g1e2a5c4d3c4f8e7e1g1d7d6b2b3e8g8e2g3c7c6c1b2d8a5.
e2e4e7e5b1c3b8c6f2f4e5f4d2d4d7d5e4d5d8h4e1e2h4e7e2f2e7h4g2g3f4g3f2g2c6d4h2g3h4g4.
e2e4e7e5b1c3b8c6f2f4e5f4d2d4d8h4e1e2g8f6g1f3h4g4d4d5c6e5h2h3g4h5c1f4e5f3g2f3d7d6.
e2e4e7e5b1c3g8f6f1c4f6e4d1h5e4d6c4b3f8e7g1f3b8c6f3e5c6e5h5e5e8g8c3d5f8e8e1g1e7f8.
e2e4e7e5b1c3g8f6f1c4f8c5d2d3d7d6f2f4c8e6c4e6f7e6g1f3e5f4c1f4e8g8c3a4c5b4c2c3b4a5.
e2e4e7e5b1c3g8f6f1c4f8c5f2f4d7d6g1f3c7c6d2d3b7b5c4b3d8e7d1e2b8d7h1f1c5b4f4e5d6e5.
e2e4e7e5b1c3g8f6f2f4d7d5f4e5f6e4g1f3f8e7d1e2e4c3d2c3c7c5c1f4b8c6e1c1c8e6h2h4h7h6.
e2e4e7e5b1c3g8f6g1f3b8c6f1b5c6d4b5a4f8c5f3e5e8g8e5d3c5b6e4e5f6e8c3d5c7c6d5e3d7d6.
e2e4e7e5b1c3g8f6g1f3b8c6f1b5f8b4e1g1e8g8d2d3d7d6c1g5b4c3b2c3h7h6g5h4c8d7a1b1a7a6.
e2e4e7e5b1c3g8f6g2g3d7d5e4d5f6d5f1g2d5c3b2c3f8d6g1e2e8g8e1g1b8d7d2d3d7f6c3c4c7c6.
e2e4e7e5b1c3g8f6g2g3d7d5e4d5f6d5f1g2d5c3b2c3f8d6g1f3e8g8e1g1b8d7f1e1a8b8d2d4e5d4.
e2e4e7e5b1c3g8f6g2g3d7d5e4d5f6d5f1g2d5c3b2c3f8d6g1f3e8g8e1g1c7c5d2d3b8c6f3d2d8d7.
e2e4e7e5b1c3g8f6g2g3f8b4g1e2c7c6f1g2e8g8e1g1d7d5e4d5c6d5d2d4e5d4d1d4b8c6d4d3b4c3.
e2e4e7e5d2d4e5d4d1d4b8c6d4e3g8f6c1d2f8e7b1c3d7d5e4d5f6d5e3g3d5c3d2c3e7f6c3f6d8f6.
e2e4e7e5f1c4g8f6b1c3b8c6f2f4f8c5f4e5c6e5c4b3c5g1h1g1f6g4d2d4d8h4e1d2e5c6d1f3g4f6.
e2e4e7e5f1c4g8f6d2d3b8c6g1f3f8c5c2c3d7d6e1g1e8g8b1d2a7a6c4b3c8e6f1e1e6b3d2b3c5a7.
e2e4e7e5f1c4g8f6d2d3c7c6g1f3f8e7c4b3d7d6b1d2b8a6c2c3e8g8e1g1c8e6b3c2f6d7d3d4a6c7.
e2e4e7e5f1c4g8f6d2d3f8c5b1c3c7c6c1g5h7h6g5h4b7b5c4b3d7d6d1e2b8d7c3d1d7f8f2f3f8g6.
e2e4e7e5f1c4g8f6d2d4b8c6g1f3d8e7e1g1d7d6b1c3c8g4d4e5c6e5c4e2e8c8c1g5e5f3e2f3g4f3.
e2e4e7e5f1c4g8f6d2d4b8c6g1f3f6e4d4e5d8e7d1d5e4c5e1g1h7h6b1c3c6b4d5d1c7c6a2a3b4a6.
e2e4e7e5f1c4g8f6d2d4e5d4g1f3f8c5e4e5d7d5e5f6d5c4d1e2c8e6f6g7h8g8c1g5c5e7g5e7e8e7.
e2e4e7e5f2f4e5f4g1f3g8e7d2d4d7d5b1c3d5e4c3e4e7g6h2h4d8e7e1f2c8g4h4h5g6h4c1f4b8c6.
e2e4e7e5f2f4e5f4g1f3g8f6e4e5f6h5f1e2g7g6d2d4f8g7e1g1d7d6b1c3e8g8f3e1d6e5e2h5g6h5.
e2e4e7e5f2f4f8c5g1f3d7d6c2c3c8g4d2d4g4f3g2f3d8h4e1e2c5b6b1a3f7f5a3c4f5e4f4e5d6e5.
e2e4e7e5g1f3b8c6b1c3g7g6d2d4e5d4f3d4f8g7c1e3g8f6f1e2e8g8e1g1f8e8d4c6b7c6e2f3c8b7.
e2e4e7e5g1f3b8c6b1c3g8f6d2d4e5d4f3d4f8b4d4c6b7c6f1d3d7d5e4d5c6d5e1g1e8g8c1g5c7c6.
e2e4e7e5g1f3b8c6b1c3g8f6d2d4e5d4f3d4f8b4d4c6b7c6f1d3d7d5e4d5c6d5e1g1e8g8c1g5c7c6.
e2e4e7e5g1f3b8c6b1c3g8f6f1b5c6d4b5a4f8c5e1g1e8g8d2d3c7c6f3d4c5d4c3e2d4b6c1g5h7h6.
e2e4e7e5g1f3b8c6b1c3g8f6f1b5d7d6d2d4c8d7e1g1f8e7f1e1e5d4f3d4e8g8b5c6b7c6c1g5h7h6.
e2e4e7e5g1f3b8c6b1c3g8f6f1b5d7d6d2d4c8d7e1g1f8e7f1e1e5d4f3d4e8g8d4e2a7a6b5d3f6g4.
e2e4e7e5g1f3b8c6b1c3g8f6f1b5d7d6d2d4c8d7e1g1f8e7f1e1e5d4f3d4e8g8d4e2c6e5e2g3d7b5.
e2e4e7e5g1f3b8c6b1c3g8f6f1b5f8b4e1g1e8g8c3d5f6d5e4d5e5e4d5c6e4f3d1f3d7c6b5d3b4d6.
e2e4e7e5g1f3b8c6b1c3g8f6f1b5f8b4e1g1e8g8d2d3b4c3b2c3d7d6b5c6b7c6c1g5h7h6g5f6d8f6.
e2e4e7e5g1f3b8c6b1c3g8f6f1b5f8b4e1g1e8g8d2d3b4c3b2c3d7d6c1g5d8e7f1e1c6d8d3d4d8e6.
e2e4e7e5g1f3b8c6b1c3g8f6f1b5f8b4e1g1e8g8d2d3d7d6c1g5b4c3b2c3c6e7b5c4e7g6f3h4g6f4.
e2e4e7e5g1f3b8c6b1c3g8f6f1b5f8b4e1g1e8g8d2d3d7d6c1g5b4c3b2c3c6e7b5c4e7g6f3h4g6f4.
e2e4e7e5g1f3b8c6b1c3g8f6g2g3d7d5e4d5f6d5f1g2d5c3b2c3f8d6e1g1e8g8a1b1a8b8d2d4h7h6.
e2e4e7e5g1f3b8c6b1c3g8f6g2g3f8b4f1g2d7d6d2d3c8g4h2h3g4h5e1g1h7h6c3d5f6d5e4d5c6e7.
e2e4e7e5g1f3b8c6c2c3g8f6d2d4f6e4d4d5c6b8f1d3e4f6f3e5d7d6d3b5b8d7e5f3f8e7e1g1e8g8.
e2e4e7e5g1f3b8c6d2d4e5d4f3d4d8f6c1e3f8c5c2c3g8e7f1c4c6e5c4e2f6g6e1g1e8g8b1d2d7d5.
e2e4e7e5g1f3b8c6d2d4e5d4f3d4d8h4d4b5h4e4c1e3e8d8b1c3e4e5c3d5g8f6b5c7f8d6f2f4e5e4.
e2e4e7e5g1f3b8c6d2d4e5d4f3d4f8c5c1e3d8f6c2c3g8e7f1c4e8g8e1g1c5b6c4b3d7d6g1h1c6d4.
e2e4e7e5g1f3b8c6d2d4e5d4f3d4f8c5d4b3c5b6b1c3g8f6c1g5d7d6d1d2h7h6g5f4c8e6e1c1f6h5.
e2e4e7e5g1f3b8c6d2d4e5d4f3d4f8c5d4c6d8f6d1d2d7c6b1c3c8e6c3a4a8d8f1d3c5d4c2c3b7b5.
e2e4e7e5g1f3b8c6d2d4e5d4f3d4f8c5d4c6d8f6d1d2d7c6b1c3c8e6c3a4a8d8f1d3c5d4e1g1a7a6.
e2e4e7e5g1f3b8c6d2d4e5d4f3d4f8c5d4c6d8f6d1d2d7c6b1c3c8e6c3a4a8d8f1d3c5d4e1g1f6h4.
e2e4e7e5g1f3b8c6d2d4e5d4f3d4f8c5d4c6d8f6d1d2d7c6b1c3c8e6c3a4a8d8f1d3c5d4e1g1g8e7.
e2e4e7e5g1f3b8c6d2d4e5d4f3d4f8c5d4c6d8f6d1d2d7c6b1c3c8e6c3a4c5d6d2e3g8h6h2h3e8g8.
e2e4e7e5g1f3b8c6d2d4e5d4f3d4f8c5d4c6d8f6d1d2d7c6f1d3c8e6e1g1f6e7d2e2g8f6c1e3c5e3.
e2e4e7e5g1f3b8c6d2d4e5d4f3d4f8c5d4f5d8f6b1c3g8e7f5e3e8g8f1d3c6e5d3e2e5g6g2g3d7d6.
e2e4e7e5g1f3b8c6d2d4e5d4f3d4g8f6b1c3f8b4d4c6b7c6f1d3d7d5e4d5c6d5e1g1e8g8c1g5c7c6.
e2e4e7e5g1f3b8c6d2d4e5d4f3d4g8f6d4c6b7c6e4e5d8e7d1e2f6d5b1d2d5b6c2c4c8b7b2b3e8c8.
e2e4e7e5g1f3b8c6d2d4e5d4f3d4g8f6d4c6b7c6e4e5d8e7d1e2f6d5c2c4c8a6b2b3e8c8g2g3d8e8.
e2e4e7e5g1f3b8c6d2d4e5d4f3d4g8f6d4c6b7c6e4e5d8e7d1e2f6d5c2c4c8a6b2b3g7g5c1a3d7d6.
e2e4e7e5g1f3b8c6d2d4e5d4f3d4g8f6d4c6b7c6e4e5d8e7d1e2f6d5c2c4d5b6b1d2c8b7b2b3e8c8.
e2e4e7e5g1f3b8c6d2d4e5d4f3d4g8f6d4c6b7c6e4e5d8e7d1e2f6d5c2c4d5b6b1d2e7e6b2b3a7a5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4b7b5a4b3c6a5e1g1d7d6c2c3a5b3a2b3c8b7d2d3f8e7c3c4e7f6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4b7b5a4b3g8f6e1g1f8e7f1e1d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4d7d6a4c6b7c6d2d4e5d4d1d4g8f6e1g1f8e7e4e5c6c5d4d3d6e5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4d7d6a4c6b7c6d2d4f7f6b1c3g8e7c1e3e7g6d1e2f8e7e1c1c8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4d7d6c2c3c8d7d2d4g7g6c1g5f7f6g5e3g8h6e1g1f8g7h2h3h6f7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4d7d6c2c3c8d7d2d4g7g6e1g1f8g7d4d5c6e7a4d7d8d7c3c4h7h6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4d7d6c2c3c8d7d2d4g7g6e1g1f8g7d4d5c6e7a4d7d8d7c3c4h7h6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4d7d6c2c3c8d7d2d4g7g6e1g1f8g7f1e1g8e7d4e5c6e5f3e5g7e5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4d7d6c2c3c8d7d2d4g8e7a4b3h7h6b1a3e7g6a3c4f8e7c4e3e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4d7d6c2c3c8d7d2d4g8e7a4b3h7h6b1d2e7g6d2c4f8e7c4e3e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4d7d6c2c3c8d7d2d4g8e7a4b3h7h6b1d2e7g6d2c4f8e7e1g1e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4d7d6c2c3c8d7d2d4g8e7a4b3h7h6b1d2e7g6d2c4f8e7e1g1e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4d7d6c2c3c8d7d2d4g8e7c1e3h7h6b1d2g7g5d4e5d6e5h2h4g5g4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4d7d6c2c3c8d7d2d4g8e7h2h4h7h6c1e3e5d4c3d4d6d5e4e5b7b5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4d7d6c2c3f7f5e4f5c8f5d2d4e5e4f3g5d6d5f2f3e4e3f3f4f8d6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4d7d6c2c3f7f5e4f5c8f5e1g1f5d3f1e1f8e7a4c2d3c2d1c2g8f6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4d7d6c2c3g8f6e1g1c8d7d2d4f8e7d4d5c6b8a4c2d7g4c3c4b8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4d7d6c2c3g8f6e1g1f8e7d2d4c8d7b1d2e8g8f1e1f8e8a2a3e7f8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4d7d6d2d4c8d7a4b3f8e7d4e5d6e5d1d5d7e6d5d8a8d8b3e6f7e6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4d7d6e1g1c8d7c2c4g8f6b1c3f8e7d2d4c6d4f3d4e5d4a4d7f6d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6a4c6d7c6b1c3f8d6d2d3c6c5h2h3c8e6c1e3h7h6a2a4c5c4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6d1e2b7b5a4b3f8e7c2c3d7d5d2d3e8g8c1g5d5e4d3e4f6d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6d1e2b7b5a4b3f8e7c2c3e8g8e1g1d7d5d2d3d5e4d3e4c8g4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6d1e2f8e7d2d3b7b5a4b3e8g8e1g1d7d6c2c3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6d1e2f8e7e1g1b7b5a4b3d7d6a2a4c8g4c2c3e8g8h2h3c6a5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6d2d3d7d6c2c3c8d7e1g1g7g6b1d2f8g7f1e1e8g8d2f1b7b5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6d2d3d7d6c2c3f8e7b1d2c8d7e1g1e8g8f1e1f8e8d2f1h7h6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6d2d3d7d6c2c3f8e7b1d2e8g8e1g1b7b5a4c2f6h5a2a4b5b4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6d2d3f8c5c2c3b7b5a4c2d7d5d1e2e8g8c1g5d5e4d3e4h7h6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6d2d4e5d4e1g1f8e7f1e1e8g8e4e5f6e8c2c3d4c3b1c3d7d6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1b7b5a4b3c8b7d2d3f8c5a2a4e8g8c1g5h7h6g5h4g7g5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1b7b5a4b3c8b7d2d3f8d6c2c3e8g8f1e1c6a5b3c2f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1b7b5a4b3c8b7f1e1f8c5c2c3d7d6d2d4c5b6c1e3e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1b7b5a4b3c8b7f1e1f8c5c2c3d7d6d2d4c5b6c1e3e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1b7b5a4b3f8c5a2a4a8b8c2c3d7d6d2d4c5b6b1a3e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1b7b5a4b3f8c5a2a4c8b7d2d3d7d6b1c3b5b4c3d5c6a5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1b7b5a4b3f8c5a2a4c8b7d2d3e8g8b1c3c6a5f3e5a5b3.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1b7b5a4b3f8c5d2d3d7d6a2a4a8b8a4b5a6b5c1e3e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1b7b5a4b3f8e7d1e2e8g8c2c3d7d6f1d1c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1b7b5a4b3f8e7d2d4d7d6d4e5d6e5d1e2c8g4c2c3e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1b7b5a4b3f8e7d2d4d7d6d4e5d6e5d1e2c8g4c2c3e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1b7b5a4b3f8e7f1e1d7d6a2a4c8d7c2c3e8g8d2d4h7h6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1b7b5a4b3f8e7f1e1e8g8c2c3d7d5e4d5f6d5f3e5c6e5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1d7d6a4c6b7c6d2d4e5d4f3d4c6c5d4f3f8e7b1c3e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1d7d6f1e1b7b5a4b3c6a5d2d4a5b3a2b3f6d7b3b4f8e7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5a2a4a8b8a4b5a6b5d4e5c8e6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5a2a4a8b8a4b5a6b5d4e5c8e6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5a2a4c6d4f3d4e5d4a4b5f8c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5a2a4c6d4f3d4e5d4d1d4c8e6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6b1d2e4c5c2c3d5d4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6b1d2e4c5c2c3d5d4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6b1d2e4c5c2c3d5d4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6b1d2e4c5c2c3d5d4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6b1d2e4c5c2c3d5d4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6b1d2e4c5c2c3d5d4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6b1d2e4c5c2c3d5d4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6b1d2e4c5c2c3d5d4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6b1d2e4c5c2c3f8e7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6b1d2e4c5c2c3f8e7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6b1d2e4c5c2c3g7g6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c1e3f8c5d1e2d8e7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c1e3f8e7c2c3d8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c1e3f8e7c2c3d8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c1e3f8e7c2c3d8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c1e3f8e7c2c3d8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c1e3f8e7c2c3e4c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c1e3f8e7c2c3e4c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3e4c5b3c2e6g4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3e4c5b3c2e6g4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3f8c5b1d2e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3f8c5b1d2e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3f8c5b1d2e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3f8c5b1d2e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3f8c5b1d2e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3f8c5b1d2e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3f8c5b1d2e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3f8c5b1d2e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3f8c5d1d3e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3f8c5d1d3e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3f8c5d1d3e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3f8c5d1d3e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3f8e7a2a4b5b4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3f8e7b1d2e4c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3f8e7b1d2e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3f8e7b3c2e4c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3f8e7c1e3e4c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3f8e7c1e3e4c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3f8e7c1e3e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6c2c3f8e7c1e3e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6d1e2e4c5f1d1b5b4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6d1e2e4c5f1d1c5b3.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6d1e2e4c5f1d1c5b3.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6d1e2f8c5c1e3d8e7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6d1e2f8e7f1d1e4c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6d1e2f8e7f1d1e4c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6d1e2f8e7f1d1e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6d1e2f8e7f1d1e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6d1e2f8e7f1d1e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6d1e2f8e7f1d1e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5d4e5c8e6d1e2f8e7f1d1e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5f3e5c6e5d4e5c7c6b1d2e4d2.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4d2d4b7b5a4b3d7d5f3e5c6e5d4e5c7c6c2c3f8c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f6e4f1e1e4c5b1c3f8e7c3d5e8g8a4c6d7c6d5e7d8e7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8c5c2c3b7b5a4b3d7d6a2a4c8g4d2d3e8g8h2h3g4f3.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7a4c6d7c6d1e2c8g4h2h3g4f3e2f3e8g8d2d3f6d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7a4c6d7c6d1e2c8g4h2h3g4f3e2f3e8g8d2d3f6d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7a4c6d7c6d2d3d8d6b1d2c8e6b2b3f6d7c1b2c6c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7a4c6d7c6d2d3f6d7b1c3e8g8c1e3c6c5c3d5e7d6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7a4c6d7c6d2d3f6d7b1d2e8g8d2c4f7f6f3h4d7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7a4c6d7c6d2d3f6d7b2b3e8g8c1b2f7f6b1c3d7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7a4c6d7c6f3e5f6e4d2d4e8g8c1e3f7f6e5d3c8f5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7b1c3b7b5a4b3d7d6c3d5c6a5d5e7d8e7d2d4c8b7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7b1c3d7d6a4c6b7c6d2d4f6d7d4e5d6e5c1e3e7d6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7b1c3d7d6a4c6b7c6d2d4f6d7d4e5d6e5c3a4e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7d1e2b7b5a4b3e8g8c2c3d7d5d2d3d5d4b1d2e7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7d1e2b7b5a4b3e8g8c2c3d7d5d2d3d5d4c3d4c6d4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7d1e2b7b5a4b3e8g8c2c3d7d5d2d3d5d4c3d4c6d4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7d1e2b7b5a4b3e8g8c2c3d7d5d2d3f8e8f1d1c8b7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7d1e2b7b5a4b3e8g8c2c3d7d6d2d4c8g4f1d1e5d4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7d2d3b7b5a4b3d7d6a2a4c8b7b1c3b5b4c3d5c6a5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7d2d3d7d6c2c3e8g8f1e1b7b5a4c2d6d5e4d5d8d5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7d2d3d7d6c2c3e8g8f1e1f6d7a4c2e7f6b1d2d7b6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7d2d4e5d4e4e5f6e4f3d4e8g8d4f5d7d5a4c6b7c6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7d2d4e5d4e4e5f6e4f3d4e8g8d4f5d7d5f5e7c6e7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3c6a5b3c2c7c5d2d4d8c7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3c6a5b3c2c7c5d2d4d8c7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3c6a5b3c2c7c5d2d4d8c7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3c8g4d2d3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8a2a4c8g4d2d3c6a5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8d2d3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8d2d3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8d2d4c8g4c1e3e5d4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8d2d4c8g4c1e3e5d4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8d2d4c8g4c1e3e5d4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8d2d4c8g4d4d5c6a5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6b8d2d4b8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6b8d2d4b8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6b8d2d4b8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6b8d2d4b8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6b8d2d4b8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6b8d2d4b8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6b8d2d4b8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6b8d2d4b8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6b8d2d4b8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6b8d2d4b8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6b8d2d4b8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6b8d2d4b8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6b8d2d4b8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6b8d2d4b8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6b8d2d4b8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6b8d2d4b8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6b8d2d4c8b7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c6b8d2d4c8b7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d3f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8e6d2d4e6b3.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8e6d2d4e6b3.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8e6d2d4e6b3.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8e6d2d4e6b3.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3c8e6d2d4e6b3.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3d8d7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3f6d7d2d4d7b6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3f6d7d2d4d7b6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3f6d7d2d4e7f6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3f6d7d2d4e7f6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3f6d7d2d4e7f6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3f6d7d2d4e7f6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3f6d7d2d4e7f6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3f6d7d2d4e7f6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3f6d7d2d4e7f6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3f6d7d2d4e7f6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3f8e8d2d4c8b7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3f8e8d2d4c8b7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3f8e8d2d4c8b7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3f8e8d2d4c8b7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3h7h6d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3h7h6d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3h7h6d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3h7h6d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3h7h6d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3h7h6d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3d7d6c2c3e8g8h2h3h7h6d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8a2a4b5b4c2c3d7d6a4a5b4c3.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8a2a4b5b4d2d3d7d6a4a5c8e6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8a2a4b5b4d2d3d7d6a4a5c8e6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8a2a4c8b7d2d3d7d6b1d2f6d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8a2a4c8b7d2d3d7d6b1d2f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8a2a4c8b7d2d3d7d6c2c3c6b8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8a2a4c8b7d2d3f8e8b1d2e7f8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d5e4d5f6d5f3e5c6e5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d5e4d5f6d5f3e5c6e5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d5e4d5f6d5f3e5c6e5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d5e4d5f6d5f3e5c6e5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d5e4d5f6d5f3e5c6e5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d5e4d5f6d5f3e5c6e5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d5e4d5f6d5f3e5c6e5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d5e4d5f6d5f3e5c6e5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d5e4d5f6d5f3e5c6e5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d5e4d5f6d5f3e5c6e5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d5e4d5f6d5f3e5c6e5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6d2d3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6d2d3f6d7b1d2d7b6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3c6b8d2d4b8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3c8b7d2d4c6b8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3c8b7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3c8e6d2d4e6b3.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3d8d7d2d4f8e8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3f6d7d2d4d7b6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3f6d7d2d4d7b6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3f6d7d2d4d7b6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3f6d7d2d4d7b6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8c2c3d7d6h2h3f6d7d2d4e7f6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8d2d3d7d6c2c3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8d2d3d7d6c2c3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8d2d3d7d6c2c3c6a5b3c2c7c5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8d2d4d7d6c2c3c8g4c1e3e5d4.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8d2d4d7d6c2c3c8g4d4d5c6a5.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8d2d4d7d6c2c3c8g4h2h3g4f3.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8h2h3c8b7d2d3d7d6c2c3c6b8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1b7b5a4b3e8g8h2h3d7d6c2c3c6b8d2d4b8d7.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1d7d6a4c6b7c6d2d4e5d4f3d4c8d7c1g5e8g8.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1d7d6a4c6b7c6d2d4f6d7d4e5d6e5b1d2f7f6.
e2e4e7e5g1f3b8c6f1b5a7a6b5a4g8f6e1g1f8e7f1e1d7d6c2c3c8g4d2d4f6d7c1e3f7f5e4f5g4f5.
e2e4e7e5g1f3b8c6f1b5a7a6b5c6b7c6f3e5d8e7d2d4f7f6e5f3e7e4d1e2e4e2e1e2a6a5c1f4c8a6.
e2e4e7e5g1f3b8c6f1b5a7a6b5c6d7c6b1c3c8g4h2h3g4f3d1f3g8e7d2d3c6c5f3g3e7g6c1e3f8d6.
e2e4e7e5g1f3b8c6f1b5a7a6b5c6d7c6b1c3f7f6d2d4e5d4d1d4d8d4f3d4c8d7c1e3e8c8e1c1g8e7.
e2e4e7e5g1f3b8c6f1b5a7a6b5c6d7c6b1c3f7f6d2d4e5d4d1d4f8d6c1e3g8e7f3d2c6c5d4d3b7b5.
e2e4e7e5g1f3b8c6f1b5a7a6b5c6d7c6d2d4e5d4d1d4c8g4b1c3d8d4f3d4e8c8c1e3f8b4d4e2g4e2.
e2e4e7e5g1f3b8c6f1b5a7a6b5c6d7c6d2d4e5d4d1d4c8g4b1c3d8d4f3d4e8c8d4e2f8c5f2f3g4e6.
e2e4e7e5g1f3b8c6f1b5a7a6b5c6d7c6d2d4e5d4d1d4d8d4f3d4c6c5d4e2c8d7b1c3e8c8c1f4d7c6.
e2e4e7e5g1f3b8c6f1b5a7a6b5c6d7c6d2d4e5d4d1d4d8d4f3d4c6c5d4e2c8d7b2b3d7c6f2f3f8e7.
e2e4e7e5g1f3b8c6f1b5a7a6b5c6d7c6e1g1c8g4h2h3h7h5d2d3d8f6b1d2g8e7d2c4g4f3d1f3f6f3.
e2e4e7e5g1f3b8c6f1b5a7a6b5c6d7c6e1g1d8d6b1a3b7b5c2c4g8f6d1e2c8g4f1d1f8e7d2d3d6e6.
e2e4e7e5g1f3b8c6f1b5a7a6b5c6d7c6e1g1d8d6b1a3c8e6d1e2f7f6f1d1g7g5d2d4g5g4f3e1e8c8.
e2e4e7e5g1f3b8c6f1b5a7a6b5c6d7c6e1g1d8d6d2d3f7f6c1e3c8g4b1d2e8c8a1b1g8e7b2b4g7g5.
e2e4e7e5g1f3b8c6f1b5a7a6b5c6d7c6e1g1d8d6d2d4e5d4f3d4c8d7c1e3e8c8b1d2g8h6h2h3d6g6.
e2e4e7e5g1f3b8c6f1b5a7a6b5c6d7c6e1g1f7f6d2d4c8g4c2c3f8d6d4e5f6e5d1b3g4f3g2f3b7b6.
e2e4e7e5g1f3b8c6f1b5a7a6b5c6d7c6e1g1f7f6d2d4c8g4d4e5d8d1f1d1f6e5b1d2e8c8d1e1f8d6.
e2e4e7e5g1f3b8c6f1b5a7a6b5c6d7c6e1g1f7f6d2d4c8g4d4e5d8d1f1d1f6e5d1d3f8d6b1d2g8f6.
e2e4e7e5g1f3b8c6f1b5a7a6b5c6d7c6e1g1f7f6d2d4e5d4f3d4c6c5d4b3d8d1f1d1c8g4f2f3g4e6.
e2e4e7e5g1f3b8c6f1b5a7a6b5c6d7c6e1g1f7f6d2d4e5d4f3d4c6c5d4e2d8d1f1d1c8d7b1c3g8e7.
e2e4e7e5g1f3b8c6f1b5a7a6b5c6d7c6e1g1g8e7f3e5d8d4d1h5g7g6h5g5f8g7e5d3f7f5e4e5c6c5.
e2e4e7e5g1f3b8c6f1b5c6d4f3d4e5d4e1g1c7c6b5c4g8f6d2d3d7d5e4d5f6d5f1e1c8e6b1d2f8b4.
e2e4e7e5g1f3b8c6f1b5c6d4f3d4e5d4e1g1c7c6b5c4g8f6f1e1d7d6d2d3f8e7b1d2e8g8d2f3c6c5.
e2e4e7e5g1f3b8c6f1b5d7d6b1c3a7a6b5c4c8e6c4e6f7e6d2d4e5d4f3d4c6d4d1d4g8e7c1g5e7c6.
e2e4e7e5g1f3b8c6f1b5d7d6b1c3c8d7d2d4g8e7c1g5f7f6g5e3e7g6d1d2a7a6b5a4b7b5a4b3c6a5.
e2e4e7e5g1f3b8c6f1b5d7d6c2c3c8d7e1g1g8e7d2d4e7g6d4d5c6b8b5d7b8d7b1a3f8e7a3c2d7c5.
e2e4e7e5g1f3b8c6f1b5d7d6d2d4c8d7b1c3g8e7b5c4c6d4f3d4e5d4d1d4e7c6d4e3c6e5c4b3c7c6.
e2e4e7e5g1f3b8c6f1b5d7d6d2d4c8d7b1c3g8e7b5c4e5d4f3d4c6d4d1d4e7c6d4e3c6e5c4b3d7e6.
e2e4e7e5g1f3b8c6f1b5d7d6d2d4c8d7b1c3g8e7b5c4e5d4f3d4c6d4d1d4e7c6d4e3d7e6c3d5f8e7.
e2e4e7e5g1f3b8c6f1b5d7d6d2d4c8d7b1c3g8e7c1e3e7g6d1d2f8e7e1c1a7a6b5e2e5d4f3d4c6d4.
e2e4e7e5g1f3b8c6f1b5d7d6d2d4c8d7b1c3g8e7c1g5f7f6g5e3e7c8c3e2f8e7c2c3e8g8b5d3c8b6.
e2e4e7e5g1f3b8c6f1b5d7d6d2d4c8d7d4e5d6e5e1g1f8d6b1c3g8e7c1g5f7f6g5e3e8g8b5c4g8h8.
e2e4e7e5g1f3b8c6f1b5f7f5b1c3f5e4c3e4d7d5f3e5d5e4e5c6d8g5d1e2g8f6f2f4g5f4c6e5c7c6.
e2e4e7e5g1f3b8c6f1b5f7f5b1c3f5e4c3e4d7d5f3e5d5e4e5c6d8g5d1e2g8f6f2f4g5h4g2g3h4h3.
e2e4e7e5g1f3b8c6f1b5f7f5b1c3f5e4c3e4g8f6d1e2d7d5e4f6g7f6d2d4f8g7d4e5e8g8e5e6f8e8.
e2e4e7e5g1f3b8c6f1b5f7f5d2d3f5e4d3e4g8f6e1g1d7d6b1c3f8e7a2a3c8g4h2h3g4f3d1f3e8g8.
e2e4e7e5g1f3b8c6f1b5f7f5d2d3f5e4d3e4g8f6e1g1f8c5b1c3d7d6c1e3c5b6c3d5e8g8e3g5c8e6.
e2e4e7e5g1f3b8c6f1b5f8b4e1g1g8e7c2c3b4a5b5c6e7c6b2b4a5b6b4b5c6a5f3e5e8g8d2d4d7d5.
e2e4e7e5g1f3b8c6f1b5f8c5c2c3f7f5d2d4f5e4d4c5e4f3d1f3g8f6c1g5e8g8e1g1d8e7b5c4g8h8.
e2e4e7e5g1f3b8c6f1b5f8c5c2c3g8e7d2d4e5d4c3d4c5b4c1d2b4d2d1d2a7a6b5a4d7d5e4d5d8d5.
e2e4e7e5g1f3b8c6f1b5f8c5c2c3g8e7d2d4e5d4c3d4c5b4c1d2b4d2d1d2d7d5e4d5e7d5b5c6b7c6.
e2e4e7e5g1f3b8c6f1b5f8c5c2c3g8e7e1g1e7g6d2d4e5d4c3d4c5b6b1c3e8g8a2a4a7a6b5c4h7h6.
e2e4e7e5g1f3b8c6f1b5f8c5c2c3g8f6d2d4e5d4e4e5f6e4c3d4c5b4b1d2e8g8e1g1d7d5d1a4b4d2.
e2e4e7e5g1f3b8c6f1b5f8c5e1g1c6d4f3d4c5d4c2c3d4b6d2d4c7c6b5c4d7d6d1b3d8c7d4e5d6e5.
e2e4e7e5g1f3b8c6f1b5g7g6c2c3a7a6b5a4d7d6d2d4c8d7c1g5f7f6g5e3g8h6e1g1f8g7h2h3h6f7.
e2e4e7e5g1f3b8c6f1b5g7g6c2c3a7a6b5a4d7d6d2d4c8d7c1g5f7f6g5e3g8h6h2h3f8g7b1d2d8e7.
e2e4e7e5g1f3b8c6f1b5g7g6c2c3a7a6b5a4d7d6d2d4c8d7c1g5f7f6g5e3g8h6h2h3f8g7b1d2h6f7.
e2e4e7e5g1f3b8c6f1b5g7g6c2c3a7a6b5c4d7d6d2d4f8g7c1g5d8d7d4e5d6e5d1e2g8f6b1a3e8g8.
e2e4e7e5g1f3b8c6f1b5g8f6b1c3f8b4e1g1d7d6c3d5b4c5d2d4e5d4f3d4c5d4d1d4e8g8d5f6d8f6.
e2e4e7e5g1f3b8c6f1b5g8f6b1c3f8b4e1g1e8g8d2d3b4c3b2c3d7d6c1g5d8e7f1e1c6d8d3d4d8e6.
e2e4e7e5g1f3b8c6f1b5g8f6b1c3f8b4e1g1e8g8d2d3d7d6c1g5c8e6d3d4e5d4f3d4h7h6g5h4c6e5.
e2e4e7e5g1f3b8c6f1b5g8f6d1e2a7a6b5a4f8e7e1g1b7b5a4b3e8g8a2a4b5b4d2d3d7d6b1d2c8g4.
e2e4e7e5g1f3b8c6f1b5g8f6d1e2f8c5c2c3e8g8e1g1f8e8d2d3h7h6h2h3d7d6c1e3c8d7e3c5d6c5.
e2e4e7e5g1f3b8c6f1b5g8f6d2d3d7d6c2c3c8d7b5a4g7g6b1d2f8g7d2c4e8g8c4e3c6e7a4b3c7c6.
e2e4e7e5g1f3b8c6f1b5g8f6d2d3d7d6c2c3g7g6b1d2f8g7d2f1e8g8b5a4d6d5d1e2d8d6a4c2b7b6.
e2e4e7e5g1f3b8c6f1b5g8f6d2d3d7d6c2c3g7g6b1d2f8g7d2f1e8g8b5a4f6d7f1e3d7c5a4c2c5e6.
e2e4e7e5g1f3b8c6f1b5g8f6d2d3d7d6c2c3g7g6b1d2f8g7d2f1e8g8f1e3d6d5d1c2a7a6b5a4d5e4.
e2e4e7e5g1f3b8c6f1b5g8f6d2d3d7d6c2c3g7g6d3d4c8d7b1d2f8g7d4e5c6e5f3e5d6e5d1e2e8g8.
e2e4e7e5g1f3b8c6f1b5g8f6d2d3d7d6c2c3g7g6d3d4c8d7b1d2f8g7d4e5c6e5f3e5d6e5d1e2e8g8.
e2e4e7e5g1f3b8c6f1b5g8f6d2d4e5d4e1g1f8e7e4e5f6e4f3d4e8g8d4f5d7d5b5c6b7c6f5e7d8e7.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1d7d6d2d4c8d7b1c3e5d4f3d4f8e7b2b3c6d4d1d4d7b5c3b5f6d7.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1d7d6d2d4c8d7b1c3f8e7b5c6d7c6d1d3e5d4f3d4c6d7c1g5e8g8.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1d7d6d2d4c8d7b1c3f8e7b5c6d7c6d1d3e5d4f3d4e8g8c1f4f6d7.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1d7d6d2d4c8d7b1c3f8e7c1g5e8g8d4e5c6e5b5d7f6d7g5e7e5f3.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1d7d6d2d4c8d7b1c3f8e7f1e1e5d4f3d4c6d4d1d4d7b5c3b5e8g8.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1d7d6d2d4c8d7b1c3f8e7f1e1e5d4f3d4e8g8b5c6b7c6c1g5f8e8.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1d7d6d2d4c8d7b1c3f8e7f1e1e5d4f3d4e8g8b5f1f8e8f2f3e7f8.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1d7d6d2d4c8d7b1c3f8e7f1e1e5d4f3d4e8g8d4c6d7c6b5c6b7c6.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1d7d6d2d4c8d7f1e1e5d4f3d4f8e7b1c3e8g8b5c6b7c6c1g5f8e8.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1d7d6f1e1f8e7d2d4e5d4f3d4c8d7b1c3e8g8b5c6b7c6c1g5f8e8.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f6e4d2d4e4d6b5c6d7c6d4e5d6f5d1d8e8d8b1c3d8e8b2b3c8e6.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f6e4d2d4e4d6b5c6d7c6d4e5d6f5d1d8e8d8b2b3d8e8c1b2a7a5.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f6e4d2d4e4d6b5c6d7c6d4e5d6f5d1d8e8d8f1d1d8e8b1c3c8e6.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f6e4d2d4e4d6b5c6d7c6d4e5d6f5d1d8e8d8f1d1d8e8b1c3f5e7.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f6e4d2d4e4d6b5c6d7c6d4e5d6f5d1d8e8d8f1d1d8e8b1c3h7h6.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f6e4d2d4f8e7d1e2d7d5f3e5c8d7b5c6d7c6f1e1c6d7f2f3e4d6.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f6e4d2d4f8e7d1e2e4d6b5c6b7c6d4e5d6b7b1c3e8g8f1e1b7c5.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f6e4d2d4f8e7d1e2e4d6b5c6b7c6d4e5d6b7b1c3e8g8f1e1b7c5.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f6e4d2d4f8e7d1e2e4d6b5c6b7c6d4e5d6b7f1e1e8g8b1c3b7c5.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f6e4d2d4f8e7d1e2e4d6b5c6b7c6d4e5d6b7f1e1e8g8b1c3b7c5.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f6e4d2d4f8e7f1e1e4d6b5c6d7c6d4e5d6f5d1d8e7d8b1c3c8e6.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f6e4f1e1e4d6f3e5c6e5e1e5f8e7b1c3e8g8b5d3e7f6e5e3g7g6.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f6e4f1e1e4d6f3e5c6e5e1e5f8e7b5f1e8g8d2d4e7f6e5e1f8e8.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f6e4f1e1e4d6f3e5f8e7b5c6d7c6d1e2c8e6d2d3d6f5b1d2e8g8.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f6e4f1e1e4d6f3e5f8e7b5d3e8g8b1c3c6e5e1e5c7c6b2b3d6e8.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f6e4f1e1e4d6f3e5f8e7b5d3e8g8b1c3c6e5e1e5c7c6b2b3f8e8.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f6e4f1e1e4d6f3e5f8e7b5d3e8g8d1h5f7f5b1c3c6e5e1e5g7g6.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f8c5f3e5f6e4d1e2c6e5d2d4c5e7d4e5e4c5e2g4e8g8c1h6c5e6.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f8e7f1e1d7d6b5c6b7c6d2d4e5d4f3d4c8d7b1c3e8g8b2b3f8e8.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f8e7f1e1d7d6b5c6b7c6d2d4e5d4f3d4c8d7b1c3e8g8d1d3f8e8.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f8e7f1e1d7d6c2c3e8g8d2d4c8d7b5a4d8e8a4c2d7g4c1e3e5d4.
e2e4e7e5g1f3b8c6f1b5g8f6e1g1f8e7f1e1d7d6d2d4e5d4f3d4c8d7b1c3e8g8d4f3c6e5b5d7e5f3.
e2e4e7e5g1f3b8c6f1c4d7d6d2d4e5d4f3d4g8f6d4c6b7c6b1c3f8e7e1g1e8g8c1f4f6d7f4g3a8b8.
e2e4e7e5g1f3b8c6f1c4f8c5b1c3g8f6d2d3d7d6c1e3c5e3f2e3c6a5c4b3a5b3a2b3f6g4d1e2f7f6.
e2e4e7e5g1f3b8c6f1c4f8c5b2b4c5b4c2c3b4a5e1g1d7d6d2d4c8d7d1b3d8f6d4e5d6e5f1d1h7h6.
e2e4e7e5g1f3b8c6f1c4f8c5b2b4c5b4c2c3b4a5e1g1d7d6d2d4c8d7d1b3d8f6d4e5d6e5f1d1h7h6.
e2e4e7e5g1f3b8c6f1c4f8c5b2b4c5b4c2c3b4a5e1g1d7d6d2d4c8g4c4b5e5d4c3d4g4d7c1b2c6e7.
e2e4e7e5g1f3b8c6f1c4f8c5b2b4c5b4c2c3b4a5e1g1d7d6d2d4c8g4c4b5e5d4c3d4g4d7c1b2g8f6.
e2e4e7e5g1f3b8c6f1c4f8c5b2b4c5b4c2c3b4a5e1g1d7d6d2d4c8g4c4b5e5d4c3d4g4d7c1b2g8f6.
e2e4e7e5g1f3b8c6f1c4f8c5b2b4c5b4c2c3b4a5e1g1d7d6d2d4c8g4c4b5e5d4c3d4g4d7c1b2g8f6.
e2e4e7e5g1f3b8c6f1c4f8c5b2b4c5b4c2c3b4a5e1g1d7d6d2d4c8g4d1a4e5d4c3d4a7a6c4d5a5b6.
e2e4e7e5g1f3b8c6f1c4f8c5b2b4c5b4c2c3b4a5e1g1d7d6d2d4c8g4d1a4g4f3g2f3e5d4c3d4a7a6.
e2e4e7e5g1f3b8c6f1c4f8c5b2b4c5b4c2c3b4a5e1g1d8f6d2d4g8e7c1g5f6d6d1b3e8g8f1d1a5b6.
e2e4e7e5g1f3b8c6f1c4f8c5b2b4c5b4c2c3b4a5e1g1d8f6d2d4g8e7c1g5f6d6d4d5c6d8d1a4a5b6.
e2e4e7e5g1f3b8c6f1c4f8c5b2b4c5b4c2c3b4a5e1g1d8f6d2d4g8e7c1g5f6d6d4d5c6d8d1a4b7b6.
e2e4e7e5g1f3b8c6f1c4f8c5b2b4c5b4c2c3b4a5e1g1d8f6d2d4g8e7c1g5f6d6d4d5c6d8d1a4b7b6.
e2e4e7e5g1f3b8c6f1c4f8c5b2b4c5b4c2c3b4a5e1g1d8f6d2d4g8e7d1a4a5b6c1g5f6d6b1a3e5d4.
e2e4e7e5g1f3b8c6f1c4f8c5b2b4c5b4c2c3b4a5e1g1d8f6d2d4g8e7d4d5c6d8c1g5f6d6d1a4f7f6.
e2e4e7e5g1f3b8c6f1c4f8c5b2b4c5b4c2c3b4a5e1g1d8f6d2d4g8e7d4d5c6d8d1a4a5b6c1g5f6d6.
e2e4e7e5g1f3b8c6f1c4f8c5b2b4c5b4c2c3b4a5e1g1d8f6d2d4g8e7d4d5c6d8d1a4a5b6c1g5f6d6.
e2e4e7e5g1f3b8c6f1c4f8c5b2b4c5b4c2c3b4a5e1g1d8f6d2d4g8e7f3g5c6d8f2f4e5d4c3d4a5b6.
e2e4e7e5g1f3b8c6f1c4f8c5b2b4c5b4c2c3b4a5e1g1d8f6d2d4g8h6c1g5f6d6d4d5c6d8d1a4a5b6.
e2e4e7e5g1f3b8c6f1c4f8c5b2b4c5b4c2c3b4a5e1g1d8f6d2d4h7h6c4b5g8e7c1a3e5d4e4e5f6e6.
e2e4e7e5g1f3b8c6f1c4f8c5b2b4c5b4c2c3b4a5e1g1d8f6d2d4h7h6d1a4a5b6c4b5g8e7c1a3e5d4.
e2e4e7e5g1f3b8c6f1c4f8c5c2c3g8f6d2d3a7a6e1g1d7d6f1e1c5a7c4b3e8g8b1d2c8e6d2f1e6b3.
e2e4e7e5g1f3b8c6f1c4f8c5c2c3g8f6d2d3d7d6b1d2a7a6e1g1e8g8c4b3c5a7h2h3c8e6b3c2d6d5.
e2e4e7e5g1f3b8c6f1c4f8c5c2c3g8f6d2d3d7d6c4b3a7a6b1d2e8g8h2h3c5a7d2f1d6d5d1e2f8e8.
e2e4e7e5g1f3b8c6f1c4f8c5c2c3g8f6d2d4e5d4c3d4c5b4b1c3f6e4e1g1b4c3b2c3d7d5c1a3d5c4.
e2e4e7e5g1f3b8c6f1c4f8c5c2c3g8f6d2d4e5d4c3d4c5b4b1c3f6e4e1g1b4c3b2c3d7d5c1a3d5c4.
e2e4e7e5g1f3b8c6f1c4f8c5c2c3g8f6d2d4e5d4e4e5d7d5c4b5f6e4c3d4c5b6b1c3e8g8c1e3f7f5.
e2e4e7e5g1f3b8c6f1c4f8c5c2c3g8f6d2d4e5d4e4e5d7d5c4b5f6e4c3d4c5e7b1c3e8g8b5d3f7f5.
e2e4e7e5g1f3b8c6f1c4f8c5d2d3d7d6b1c3g8f6c1g5h7h6g5f6d8f6c3d5f6g6d1e2c8g4c2c3c5b6.
e2e4e7e5g1f3b8c6f1c4f8c5d2d3g8f6b1c3d7d6c1e3c5b6d1d2c6a5c4b5c7c6b5a4b6e3f2e3b7b5.
e2e4e7e5g1f3b8c6f1c4f8c5d2d3g8f6b1c3d7d6c1g5h7h6g5f6d8f6c3d5f6d8c2c3c6e7d5e3e8g8.
e2e4e7e5g1f3b8c6f1c4f8c5d2d3g8f6c1e3c5e3f2e3d7d6e1g1c6a5c4b5c7c6b5a4d8b6d1d2f6g4.
e2e4e7e5g1f3b8c6f1c4f8c5d2d3g8f6c2c3d7d6b1d2a7a6c4b3c5a7d2c4h7h6e1g1c6e7b3c2e8g8.
e2e4e7e5g1f3b8c6f1c4f8c5d2d3g8f6c2c3d7d6b1d2c6e7d2f1c7c6d1e2e8g8h2h3d6d5c4b3e7g6.
e2e4e7e5g1f3b8c6f1c4f8c5d2d3g8f6c2c3d7d6c1e3c5e3f2e3d8e7e1g1c6d8b1d2d8e6d3d4f6g4.
e2e4e7e5g1f3b8c6f1c4f8c5e1g1g8f6d2d3d7d6c2c3a7a6c4b3c5a7b1d2e8g8h2h3c8e6f1e1e6b3.
e2e4e7e5g1f3b8c6f1c4f8e7d2d3g8f6c4b3d7d5b1d2e8g8e1g1d5e4d3e4e7c5c2c3d8e7b3c2a7a5.
e2e4e7e5g1f3b8c6f1c4f8e7d2d3g8f6c4b3d7d6c2c3e8g8e1g1c6a5b3c2c7c5f1e1a5c6b1d2f8e8.
e2e4e7e5g1f3b8c6f1c4f8e7d2d4d7d6b1c3g8f6h2h3e8g8e1g1c6d4f3d4e5d4d1d4c7c6a2a4f6d7.
e2e4e7e5g1f3b8c6f1c4g8f6d2d3f8e7e1g1e8g8c2c3d7d5e4d5f6d5f1e1c8g4b1d2g8h8a2a4f7f6.
e2e4e7e5g1f3b8c6f1c4g8f6f3g5d7d5e4d5c6a5c4b5c7c6d5c6b7c6b5e2h7h6g5h3f8c5e1g1e8g8.
e2e4e7e5g1f3b8c6f1c4g8f6f3g5d7d5e4d5c6a5c4b5c7c6d5c6b7c6b5e2h7h6g5h3f8c5e1g1e8g8.
e2e4e7e5g1f3b8c6f1c4g8f6f3g5d7d5e4d5c6a5c4b5c7c6d5c6b7c6b5f1h7h6g5h3f8c5d1e2e8g8.
e2e4e7e5g1f3b8c6f1c4g8f6f3g5d7d5e4d5c6a5c4b5c7c6d5c6b7c6b5f1h7h6g5h3f8c5d2d3d8b6.
e2e4e7e5g1f3b8c6f1c4g8f6f3g5d7d5e4d5c6d4d5d6d8d6c4f7e8e7f7b3c8g4f2f3g4h5b1c3a8e8.
e2e4e7e5g1f3d7d6d2d4b8d7b1c3c7c6d4e5d6e5f1c4f8e7e1g1g8f6c1e3b7b5c4d3e8g8a2a4b5b4.
e2e4e7e5g1f3d7d6d2d4b8d7f1c4c7c6b1c3f8e7e1g1g8f6a2a4e8g8b2b3d8c7c1b2d7b6c4d3c8g4.
e2e4e7e5g1f3d7d6d2d4b8d7f1c4c7c6d4e5d6e5e1g1f8e7b1c3g8f6d1e2e8g8f1d1d8c7a2a3d7c5.
e2e4e7e5g1f3d7d6d2d4e5d4f3d4g7g6b1c3f8g7c1f4g8f6d1d2e8g8e1c1f8e8f2f3b8c6d4c6b7c6.
e2e4e7e5g1f3d7d6d2d4e5d4f3d4g8f6b1c3f8e7f1e2e8g8e1g1f8e8f1e1e7f8e2f1h7h6c1f4b8d7.
e2e4e7e5g1f3g8f6b1c3b8c6d2d4e5d4f3d4f8b4d4c6b7c6f1d3d7d5e4d5c6d5e1g1e8g8c1g5c7c6.
e2e4e7e5g1f3g8f6b1c3b8c6g2g3f8c5f1g2d7d6d2d3a7a6c1e3c5e3f2e3c8g4e1g1c6e7h2h3g4f3.
e2e4e7e5g1f3g8f6b1c3b8c6g2g3f8c5f1g2d7d6d2d3a7a6c1e3c5e3f2e3c8g4h2h3g4f3d1f3c6e7.
e2e4e7e5g1f3g8f6b1c3b8c6g2g3f8c5f1g2d7d6d2d3a7a6c1e3c8g4h2h3g4f3d1f3c6d4f3d1h7h5.
e2e4e7e5g1f3g8f6d2d4f6e4f1d3d7d5f3e5b8c6e5c6b7c6e1g1f8d6c2c4e8g8c4c5d6e7b1c3f7f5.
e2e4e7e5g1f3g8f6d2d4f6e4f1d3d7d5f3e5b8c6e5c6b7c6e1g1f8e7b1c3e4c3b2c3e8g8f1e1f8e8.
e2e4e7e5g1f3g8f6d2d4f6e4f1d3d7d5f3e5b8c6e5c6b7c6e1g1f8e7b1d2e4d2c1d2e8g8f1e1f8e8.
e2e4e7e5g1f3g8f6d2d4f6e4f1d3d7d5f3e5b8d7e5d7c8d7e1g1d8h4c2c4e8c8c4c5g7g5f2f3e4f6.
e2e4e7e5g1f3g8f6d2d4f6e4f1d3d7d5f3e5b8d7e5d7c8d7e1g1f8d6b1c3d8h4g2g3e4c3b2c3h4g4.
e2e4e7e5g1f3g8f6d2d4f6e4f1d3d7d5f3e5b8d7e5d7c8d7e1g1f8d6b1c3e4c3b2c3e8g8d1h5f7f5.
e2e4e7e5g1f3g8f6d2d4f6e4f1d3d7d5f3e5b8d7e5d7c8d7e1g1f8e7d1f3e8g8c2c3e7d6b1d2f7f5.
e2e4e7e5g1f3g8f6d2d4f6e4f1d3d7d5f3e5f8d6e1g1b8c6e5c6b7c6c2c4e8g8c4c5d6e7b1c3f7f5.
e2e4e7e5g1f3g8f6d2d4f6e4f1d3d7d5f3e5f8d6e1g1e8g8c2c4d6e5d4e5b8c6c4d5d8d5d1c2c6b4.
e2e4e7e5g1f3g8f6d2d4f6e4f1d3d7d5f3e5f8d6e1g1e8g8c2c4d6e5d4e5b8c6c4d5d8d5d1c2c6b4.
e2e4e7e5g1f3g8f6d2d4f6e4f1d3d7d5f3e5f8e7b1d2e4d2c1d2b8c6e5c6b7c6e1g1e8g8d1h5g7g6.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4c2c4f8e7d2d4d6d5f1d3b8c6c4d5d8d5e1g1c8g4b1c3e4c3.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d1e2d8e7d2d3e4f6c1g5e7e2f1e2f8e7b1c3c7c6e1c1b8a6.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d1e2d8e7d2d3e4f6c1g5e7e2f1e2f8e7b1c3c7c6e1c1b8a6.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d1e2d8e7d2d3e4f6c1g5e7e2f1e2f8e7b1c3c7c6e1c1b8a6.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3b8c6e1g1c8g4c2c4e4f6b1c3g4f3d1f3c6d4.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3b8c6e1g1c8g4c2c4e4f6b1c3g4f3d1f3c6d4.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3b8c6e1g1c8g4c2c4e4f6c4d5g4f3d1f3d8d5.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3b8c6e1g1c8g4c2c4f8e7c4d5d8d5b1c3e4c3.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3b8c6e1g1c8g4f1e1f8e7c2c4e4f6c4d5g4f3.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3b8c6e1g1f8e7c2c4c6b4d3e2c8e6b1c3e8g8.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3b8c6e1g1f8e7c2c4c6b4d3e2e8g8b1c3c8e6.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3b8c6e1g1f8e7c2c4c6b4d3e2e8g8b1c3c8e6.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3b8c6e1g1f8e7c2c4e4f6b1c3e8g8h2h3d5c4.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3f8d6e1g1e8g8c2c4c7c6c4d5c6d5b1c3e4c3.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3f8d6e1g1e8g8c2c4c7c6d1c2b8a6a2a3c8g4.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3f8d6e1g1e8g8c2c4c7c6d1c2b8a6a2a3f7f5.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3f8e7e1g1b8c6c2c4c6b4c4d5b4d3d1d3d8d5.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3f8e7e1g1b8c6c2c4c6b4c4d5b4d3d1d3d8d5.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3f8e7e1g1b8c6c2c4c6b4d3e2d5c4e2c4e8g8.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3f8e7e1g1b8c6f1e1c8f5d3b5e7f6b1d2e8g8.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3f8e7e1g1b8c6f1e1c8g4c2c3f7f5d1b3e8g8.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3f8e7e1g1b8c6f1e1c8g4c2c4e4f6b1c3d5c4.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3f8e7e1g1b8c6f1e1c8g4c2c4e4f6c4d5g4f3.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3f8e7e1g1c8f5f1e1b8c6b1d2e4d2d1d2f5d3.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4d6d5f1d3f8e7e1g1c8f5f1e1b8c6b1d2e4d2d1d2f5d3.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4e4f6f1d3f8e7h2h3e8g8e1g1c7c6f1e1b8d7c1f4f8e8.
e2e4e7e5g1f3g8f6f3e5d7d6e5f3f6e4d2d4f8e7f1d3d6d5e1g1e8g8c2c4e4f6h2h3d5c4d3c4b8d7.
e2e4e7e6d1e2c7c5f2f4b8c6g1f3g8f6g2g3d7d5e4e5f6d7f1g2c6d4f3d4c5d4e1g1d7b8d2d3b8c6.
e2e4e7e6d1e2c7c5f2f4d7d5e4d5d8d5b1c3d5d8g1f3b8c6g2g3g8f6f1g2f8e7e1g1e8g8d2d3c8d7.
e2e4e7e6d2d3c7c5b1d2b8c6g2g3g7g6f1g2f8g7g1f3g8e7e1g1e8g8c2c3d7d6a2a4f7f5d1b3d6d5.
e2e4e7e6d2d3c7c5g2g3b8c6f1g2g7g6g1f3f8g7e1g1g8e7c2c3e6e5c1e3d7d6h2h3e8g8b1a3b7b6.
e2e4e7e6d2d3d7d5b1d2b8c6g1f3g8f6g2g3f8c5f1g2d5e4d3e4e6e5e1g1e8g8c2c3a7a5h2h3b7b6.
e2e4e7e6d2d4d7d5b1c3b8c6g1f3g8f6e4d5e6d5f1b5c8g4h2h3g4f3d1f3f8e7c1g5a7a6b5c6b7c6.
e2e4e7e6d2d4d7d5b1c3d5e4c3e4b8d7f1d3f8e7g1f3g8f6e4f6d7f6e1g1e8g8f3e5c7c5d4c5d8d5.
e2e4e7e6d2d4d7d5b1c3d5e4c3e4b8d7f1d3g8f6e4f6d7f6g1f3c7c5d4c5f8c5e1g1e8g8c1g5c5e7.
e2e4e7e6d2d4d7d5b1c3d5e4c3e4b8d7g1f3f8e7f1d3g8f6e1g1e8g8d1e2b7b6c1f4c8b7a1d1d8c8.
e2e4e7e6d2d4d7d5b1c3d5e4c3e4b8d7g1f3g8f6e4f6d7f6c1g5f8e7f1d3c7c5d4c5d8a5c2c3a5c5.
e2e4e7e6d2d4d7d5b1c3d5e4c3e4b8d7g1f3g8f6e4g3c7c5f1e2c5d4f3d4f8c5d4b3c5e7e1g1e8g8.
e2e4e7e6d2d4d7d5b1c3d5e4c3e4b8d7g1f3g8f6f1d3b7b6e4f6d7f6f3e5a7a6e1g1c8b7c2c3f8e7.
e2e4e7e6d2d4d7d5b1c3d5e4c3e4g8f6e4f6d8f6g1f3c8d7c1g5f6g6f1d3f7f5h2h4b8c6d1e2h7h6.
e2e4e7e6d2d4d7d5b1c3f8b4a2a3b4c3b2c3d5e4d1g4g8f6g4g7h8g8g7h6c7c5g1e2b8c6d4c5g8g6.
e2e4e7e6d2d4d7d5b1c3f8b4a2a3b4c3b2c3d5e4d1g4g8f6g4g7h8g8g7h6c7c5g1e2b8d7e2g3g8g6.
e2e4e7e6d2d4d7d5b1c3f8b4a2a3b4c3b2c3d5e4d1g4g8f6g4g7h8g8g7h6c7c5g1e2g8g6h6d2b8d7.
e2e4e7e6d2d4d7d5b1c3f8b4a2a3b4c3b2c3d5e4d1g4g8f6g4g7h8g8g7h6c7c5g1e2g8g6h6e3b8c6.
e2e4e7e6d2d4d7d5b1c3f8b4a2a3b4c3b2c3d5e4d1g4g8f6g4g7h8g8g7h6c7c5g1e2g8g6h6e3b8c6.
e2e4e7e6d2d4d7d5b1c3f8b4a2a3b4c3b2c3d5e4d1g4g8f6g4g7h8g8g7h6g8g6h6d2b8c6g1e2b7b6.
e2e4e7e6d2d4d7d5b1c3f8b4c1d2c7c5a2a3b4c3d2c3g8f6d4c5f6e4c3g7h8g8g7d4b8c6g1f3f7f6.
e2e4e7e6d2d4d7d5b1c3f8b4c1d2d5e4d1g4d8d4e1c1g8f6g4g7h8g8g7h6b4f8h6h4g8g4h4h3d4f2.
e2e4e7e6d2d4d7d5b1c3f8b4c1d2d5e4d1g4g8f6g4g7h8g8g7h6b8c6e1c1g8g6h6h4b4c3d2c3d8d5.
e2e4e7e6d2d4d7d5b1c3f8b4d1g4g8f6g4g7h8g8g7h6g8g6h6e3f6e4f1d3f7f5g1e2c7c5d3e4f5e4.
e2e4e7e6d2d4d7d5b1c3f8b4e4d5e6d5f1d3b8c6g1e2g8e7e1g1c8f5d3f5e7f5d1d3d8d7c3d1e8g8.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5b7b6d1g4b4f8g1f3c8a6c3b5d8d7a2a4g8e7f1e2e7f5c1f4h7h5.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4a5b2b4c5d4c3b5a5c7f2f4c8d7g1f3d7b5f1b5b8c6.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4a5b2b4c5d4c3b5a5c7f2f4g8e7g1f3b8c6f1d3c7b8.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4a5b2b4c5d4c3b5a5c7f2f4g8e7g1f3c8d7b5d4b8c6.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4a5b2b4c5d4d1g4g8e7b4a5d4c3g4g7h8g8g7h7b8c6.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4a5b2b4c5d4d1g4g8e7b4a5d4c3g4g7h8g8g7h7b8d7.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4a5c1d2b8c6c3b5c6d4b5d4a5d2d1d2c5d4d2d4g8e7.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4a5c1d2b8c6c3b5c6d4d2a5d8a5b2b4a5b6b5d4c5d4.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4a5c1d2c5d4c3b5b8c6g1f3f7f6b5d4c6d4f3d4a5d2.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3d8a5c1d2a5a4d1g4e8f8g4d1g8e7g1f3b7b6.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3d8a5c1d2a5a4d1g4g7g6g4d1c5d4a1b1d4d3.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3d8c7d1g4f7f5g4g3g8e7g3g7h8g8g7h7c5d4.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3d8c7d1g4f7f5g4g3g8e7g3g7h8g8g7h7c5d4.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3d8c7d1g4f7f5g4g3g8e7g3g7h8g8g7h7c5d4.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3d8c7d1g4f7f6g1f3b8c6g4g3c7f7d4c5g8e7.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3g8e7a3a4b8c6g1f3c8d7f1e2a8c8e1g1e8g8.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3g8e7a3a4b8c6g1f3d8a5d1d2c8d7c1a3c5d4.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3g8e7a3a4b8c6g1f3d8a5d1d2c8d7f1e2a8c8.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3g8e7a3a4c8d7g1f3d8a5c1d2b8c6f1e2f7f6.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3g8e7d1g4c5d4c3d4d8c7e1d1e8g8g1f3f7f6.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3g8e7d1g4c5d4g4g7h8g8g7h7d8c7g1e2b8c6.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3g8e7d1g4d8c7g4g7h8g8g7h7c5d4g1e2b8c6.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3g8e7g1f3b7b6a3a4c8a6f1a6b8a6e1g1a6b8.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3g8e7g1f3b7b6a3a4c8a6f1a6b8a6e1g1a6b8.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3g8e7g1f3b7b6a3a4c8a6f1a6b8a6e1g1a6b8.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3g8e7g1f3b7b6f1b5c8d7b5d3d7a4h2h4h7h6.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3g8e7g1f3c8d7d4c5d7a4a1b1b8d7c1e3d8a5.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3g8e7g1f3c8d7d4c5d8c7f1d3d7a4a1b1b8d7.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3g8e7g1f3c8d7d4c5d8c7f1d3d7a4c1e3b8d7.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3g8e7g1f3c8d7d4c5d8c7f1d3d7a4e1g1b8d7.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5c7c5a2a3b4c3b2c3g8e7h2h4d8a5c1d2c5d4c3d4a5a4c2c3a4d1.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5g8e7a2a3b4c3b2c3c7c5a3a4b8c6g1f3c8d7f1d3d8c7e1g1c5c4.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5g8e7a2a3b4c3b2c3c7c5g1f3b7b6f3g5h7h6d1h5g7g6h5h3d8c7.
e2e4e7e6d2d4d7d5b1c3f8b4e4e5g8e7a2a3b4c3b2c3c7c5g1f3d8a5c1d2b8c6f1e2c5d4c3d4a5a4.
e2e4e7e6d2d4d7d5b1c3f8b4f1d3d5e4d3e4c7c5g1e2g8f6e4f3c5d4d1d4d8d4e2d4a7a6e1g1b8d7.
e2e4e7e6d2d4d7d5b1c3f8b4g1e2d5e4a2a3b4e7c3e4b8c6c1e3g8f6e2c3e8g8e4g3b7b6f1e2c8b7.
e2e4e7e6d2d4d7d5b1c3f8b4g1e2d5e4a2a3b4e7c3e4b8c6g2g4b7b6f1g2c8b7c2c3g8f6e2g3e8g8.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5d5e4c3e4b8d7e4f6d7f6g1f3c7c5d1d3f8e7g5f6e7f6d3b5c8d7.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5d5e4c3e4b8d7e4f6d7f6g1f3c7c5f1c4c5d4e1g1f8e7d1e2h7h6.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5d5e4c3e4b8d7e4f6d7f6g1f3c7c5f1c4c5d4e1g1f8e7d1e2h7h6.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5d5e4c3e4b8d7e4f6d7f6g1f3h7h6g5h4c7c5f1b5c8d7b5d7d8d7.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5d5e4c3e4b8d7e4f6d7f6g1f3h7h6g5h4g7g6f1c4f8g7e1g1e8g8.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5d5e4c3e4b8d7g1f3f8e7e4f6e7f6g5f6d8f6d1d2e8g8d2g5f6g5.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5d5e4c3e4b8d7g1f3f8e7e4f6e7f6h2h4e8g8d1e2c7c5e2e3d8a5.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5d5e4c3e4f8e7g5f6e7f6c2c3b8d7g1f3e8g8f1d3e6e5d1c2e5d4.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5d5e4c3e4f8e7g5f6e7f6g1f3b8d7d1d2f6e7e1c1d7f6f1d3e8g8.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5d5e4c3e4f8e7g5f6e7f6g1f3b8d7d1e2e8g8e1c1f6e7c1b1b7b6.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5d5e4c3e4f8e7g5f6e7f6g1f3b8d7f1c4e8g8d1e2d7b6c4b3c8d7.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5d5e4c3e4f8e7g5f6e7f6g1f3b8d7f1c4e8g8d1e2d7b6c4b3c8d7.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5d5e4c3e4f8e7g5f6e7f6g1f3b8d7f1d3c7c5d4c5d7c5d3b5e8e7.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5d5e4c3e4f8e7g5f6e7f6g1f3c8d7d1d2d7c6e4f6d8f6f3e5e8g8.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5d5e4c3e4f8e7g5f6g7f6g1f3b7b6f1c4c8b7d1e2c7c6e1c1d8c7.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5d5e4c3e4f8e7g5f6g7f6g1f3b7b6f1c4c8b7d1e2c7c6e1c1d8c7.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5d5e4c3e4f8e7g5f6g7f6g1f3b7b6f1c4c8b7d1e2c7c6e1c1d8c7.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5d5e4c3e4f8e7g5f6g7f6g1f3b7b6f1d3c8b7d1e2c7c6e1g1b8d7.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5d5e4c3e4f8e7g5f6g7f6g1f3f6f5e4c3c7c6g2g3b8d7f1g2d8c7.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5d5e4c3e4f8e7g5f6g7f6g2g3f6f5e4c3e7f6g1e2b8c6d4d5e6d5.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5f8b4e4d5d8d5g1f3c7c5g5f6g7f6d1d2b4c3d2c3b8d7a1d1h8g8.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5f8b4e4d5d8d5g5f6g7f6d1d2b4c3d2c3b8c6g1f3d5e4e1d2c8d7.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5f8b4e4d5d8d5g5f6g7f6d1d2b4c3d2c3b8c6g1f3d5e4e1d2c8d7.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5f8b4e4d5d8d5g5f6g7f6d1d2b4c3d2c3b8c6g1f3h8g8e1c1d5a2.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5f8b4e4e5h7h6g5d2b4c3b2c3f6e4d1g4e8f8g1f3c7c5f1d3e4d2.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5f8b4e4e5h7h6g5d2b4c3b2c3f6e4d1g4g7g6f1d3e4d2e1d2c7c5.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5f8b4e4e5h7h6g5d2b4c3b2c3f6e4d1g4g7g6g1f3c7c5d4c5b8d7.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5f8b4e4e5h7h6g5d2b4c3d2c3f6e4c3a5e8g8f1d3b8c6a5c3e4c3.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5f8b4f1d3d5e4d3e4c7c5d4c5b4c3b2c3d8a5g5f6g7f6d1d4e6e5.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5f8b4f1d3d5e4d3e4c7c5d4c5d8d1a1d1b8d7g5f6d7f6e4f3b4c5.
e2e4e7e6d2d4d7d5b1c3g8f6c1g5f8e7e4e5f6d7h2h4c7c5g5e7d8e7c3b5e8g8b5c7c5d4c7a8f7f6.
e2e4e7e6d2d4d7d5b1c3g8f6e4e5f6d7c3e2c7c5c2c3b8c6f2f4b7b5g1f3b5b4f4f5b4c3f5e6f7e6.
e2e4e7e6d2d4d7d5b1c3g8f6e4e5f6d7f2f4c7c5d4c5f8c5d1g4e8g8f1d3f7f5g4h3c5g1h1g1d7c5.
e2e4e7e6d2d4d7d5b1c3g8f6e4e5f6d7f2f4c7c5g1f3b8c6c1e3a7a6d1d2b7b5h2h4c8b7h4h5b5b4.
e2e4e7e6d2d4d7d5b1c3g8f6e4e5f6d7f2f4c7c5g1f3b8c6c1e3c5d4f3d4d7c5d1d2a7a6e1c1d8a5.
e2e4e7e6d2d4d7d5b1c3g8f6e4e5f6d7f2f4c7c5g1f3b8c6c1e3c5d4f3d4f8c5d1d2c5d4e3d4c6d4.
e2e4e7e6d2d4d7d5b1c3g8f6e4e5f6d7f2f4c7c5g1f3b8c6c1e3c5d4f3d4f8c5d1d2c5d4e3d4c6d4.
e2e4e7e6d2d4d7d5b1c3g8f6e4e5f6d7f2f4c7c5g1f3b8c6c1e3c5d4f3d4f8c5d1d2c5d4e3d4c6d4.
e2e4e7e6d2d4d7d5b1c3g8f6e4e5f6d7f2f4c7c5g1f3b8c6c1e3d8b6c3a4b6a5c2c3c5d4b2b4c6b4.
e2e4e7e6d2d4d7d5b1c3g8f6e4e5f6d7f2f4c7c5g1f3b8c6c1e3d8b6c3a4b6a5c2c3c5d4b2b4c6b4.
e2e4e7e6d2d4d7d5b1c3g8f6e4e5f6d7g1f3c7c5d4c5b8c6c1f4f8c5f1d3f7f6e5f6d7f6e1g1e8g8.
e2e4e7e6d2d4d7d5b1c3g8f6f1d3c7c5e4d5c5d4d3b5c8d7b5d7d8d7d5e6d7e6c3e2b8c6g1f3f8b4.
e2e4e7e6d2d4d7d5b1c3g8f6f1d3c7c5g1f3c5c4d3e2d5e4f3e5f8d6e1g1a7a6e5c4h7h6f2f3e4f3.
e2e4e7e6d2d4d7d5b1c3g8f6f1d3c7c5g1f3d5e4c3e4c5d4e4f6g7f6f3d4c8d7c1e3b8c6d3e4d8a5.
e2e4e7e6d2d4d7d5b1d2a7a6g1f3c7c5e4d5e6d5f1e2c5d4e1g1f8d6d2b3b8c6b3d4g8e7d4c6b7c6.
e2e4e7e6d2d4d7d5b1d2a7a6g1f3c7c5e4d5e6d5f1e2g8f6e1g1f8e7d4c5e7c5d2b3c5a7c1g5b8d7.
e2e4e7e6d2d4d7d5b1d2a7a6g1f3c7c5e4d5e6d5f1e2g8f6e1g1f8e7d4c5e7c5d2b3c5a7c1g5b8d7.
e2e4e7e6d2d4d7d5b1d2a7a6g1f3c7c5e4d5e6d5f1e2g8f6e1g1f8e7d4c5e7c5d2b3c5a7c1g5e8g8.
e2e4e7e6d2d4d7d5b1d2a7a6g1f3c7c5e4d5e6d5f1e2g8f6e1g1f8e7d4c5e7c5d2b3c5d6c1g5e8g8.
e2e4e7e6d2d4d7d5b1d2c7c5d4c5f8c5f1d3g8e7g1e2e8g8e1g1b8c6a2a3c6e5d2b3c5b6e2g3e5d3.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5d8d5g1f3c5d4f1c4d5d6e1g1g8f6d2b3b8c6b3d4c6d4f3d4f8e7.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5d8d5g1f3c5d4f1c4d5d6e1g1g8f6d2b3b8c6f1e1a7a6a2a4f8e7.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5d8d5g1f3c5d4f1c4d5d8e1g1a7a6d2b3b8c6b3d4c6d4d1d4d8d4.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5d8d5g1f3c5d4f1c4d5d8e1g1b8c6d2b3a7a6b3d4c6d4f3d4d8c7.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5f1b5b8c6d1e2d8e7d4c5e7e2g1e2f8c5d2b3c5b6b3d4c8d7.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5f1b5b8c6d1e2d8e7d4c5e7e2g1e2f8c5d2b3c5b6c1d2g8e7.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5f1b5b8c6g1f3c5d4d1e2d8e7f3d4e7e2d4e2g8f6c2c3f8c5.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5f1b5b8c6g1f3c5d4d1e2d8e7f3d4e7e2e1e2c8d7d2f3c6d4.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5f1b5b8c6g1f3c5d4d1e2d8e7f3d4e7e2e1e2c8d7d2f3g8f6.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5f1b5b8c6g1f3c5d4f3d4c8d7d2f3g8f6e1g1f8e7f1e1e8g8.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5f1b5c8d7b5d7b8d7g1e2f8d6e1g1g8e7d2f3c5c4c1f4d8c7.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5f1b5c8d7b5d7b8d7g1e2f8d6e1g1g8f6d2f3e8g8d4c5d7c5.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5f1b5c8d7d1e2d8e7b5d7b8d7d4c5d7c5d2b3e7e2g1e2c5b3.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5f1b5c8d7d1e2d8e7b5d7b8d7d4c5d7c5d2b3e7e2g1e2c5b3.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5f1b5c8d7d1e2f8e7d4c5g8f6b5d7b8d7d2b3e8g8g1h3f8e8.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5f1b5c8d7d1e2f8e7d4c5g8f6d2b3e8g8c1e3f8e8g1f3e7c5.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5f1b5c8d7d1e2f8e7d4c5g8f6g1f3e8g8d2b3f8e8c1e3e7c5.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5f1b5c8d7d1e2f8e7d4c5g8f6g1f3e8g8e1g1f8e8d2b3e7c5.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5g1f3b8c6f1b5f8d6d4c5d6c5e1g1g8e7d2b3c5d6c2c3c8g4.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5g1f3b8c6f1b5f8d6d4c5d6c5e1g1g8e7d2b3c5d6c2c3c8g4.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5g1f3b8c6f1b5f8d6d4c5d6c5e1g1g8e7d2b3c5d6f1e1e8g8.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5g1f3b8c6f1b5f8d6d4c5d6c5e1g1g8e7d2b3c5d6f1e1e8g8.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5g1f3b8c6f1b5f8d6d4c5d6c5e1g1g8e7d2b3c5d6f1e1e8g8.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5g1f3b8c6f1b5f8d6d4c5d6c5e1g1g8e7d2b3c5d6f1e1e8g8.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5g1f3b8c6f1b5f8d6d4c5d6c5e1g1g8e7f1e1e8g8d2b3c5d6.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5g1f3b8c6f1b5f8d6e1g1c5d4d2b3g8e7b3d4e8g8c2c3c8g4.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5g1f3b8c6f1b5f8d6e1g1c5d4d2b3g8e7b3d4e8g8c2c3c8g4.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5g1f3b8c6f1b5f8d6e1g1c5d4d2b3g8e7b3d4e8g8c2c3c8g4.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5g1f3b8c6f1b5f8d6e1g1c5d4d2b3g8e7b3d4e8g8c2c3c8g4.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5g1f3b8c6f1b5f8d6e1g1g8e7d4c5d6c5d2b3c5d6b3d4e8g8.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5g1f3b8c6f1b5f8d6e1g1g8e7d4c5d6c5d2b3c5d6c1g5e8g8.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5g1f3g8f6f1b5c8d7b5d7b8d7e1g1f8e7d4c5d7c5d2b3c5e4.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5g1f3g8f6f1b5c8d7b5d7b8d7e1g1f8e7d4c5d7c5d2b3c5e4.
e2e4e7e6d2d4d7d5b1d2c7c5e4d5e6d5g1f3g8f6f1b5c8d7b5d7b8d7e1g1f8e7d4c5d7c5f3d4e8g8.
e2e4e7e6d2d4d7d5b1d2c7c5g1f3b8c6e4d5e6d5f1b5d8e7b5e2c5d4e1g1e7d8d2b3f8d6b3d4g8e7.
e2e4e7e6d2d4d7d5b1d2c7c5g1f3b8c6e4d5e6d5f1b5f8d6d4c5d6c5d2b3c5b6e1g1g8e7f1e1e8g8.
e2e4e7e6d2d4d7d5b1d2c7c5g1f3b8c6e4d5e6d5f1b5f8d6e1g1g8e7d4c5d6c5d2b3c5b6f1e1e8g8.
e2e4e7e6d2d4d7d5b1d2c7c5g1f3c5d4e4d5d8d5f1c4d5d6e1g1b8c6d2b3g8f6b3d4c6d4f3d4a7a6.
e2e4e7e6d2d4d7d5b1d2d5e4d2e4b8d7g1f3g8f6e4f6d7f6f1d3f8e7f3e5c7c6c2c3h7h6d1e2e8g8.
e2e4e7e6d2d4d7d5b1d2d5e4d2e4f8e7g1f3g8f6f1d3b8d7e1g1e8g8d1e2b7b6e4f6d7f6c2c4c8b7.
e2e4e7e6d2d4d7d5b1d2f7f5e4f5e6f5g1f3g8f6c2c4f8d6c4d5e8g8f1e2f6d5e1g1g8h8f1e1c8e6.
e2e4e7e6d2d4d7d5b1d2g8f6e4e5f6d7c2c3c7c5f1d3b8c6g1e2c5d4c3d4d8b6d2f3f7f6e5f6d7f6.
e2e4e7e6d2d4d7d5b1d2g8f6e4e5f6d7c2c3c7c5f1d3b8c6g1e2c5d4c3d4f7f6e5f6d7f6d2f3f8d6.
e2e4e7e6d2d4d7d5b1d2g8f6e4e5f6d7f1d3c7c5c2c3b8c6d2f3c5d4c3d4f8b4c1d2d8e7a2a3b4d2.
e2e4e7e6d2d4d7d5b1d2g8f6e4e5f6d7f1d3c7c5c2c3b8c6g1e2c5d4c3d4f7f6e5f6d7f6e1g1f8d6.
e2e4e7e6d2d4d7d5b1d2g8f6f1d3c7c5e4e5f6d7c2c3b8c6g1e2c5d4c3d4f7f6e5f6d7f6e1g1f8d6.
e2e4e7e6d2d4d7d5b1d2g8f6f1d3c7c5e4e5f6d7c2c3b8c6g1e2c5d4c3d4f7f6e5f6d7f6e1g1f8d6.
e2e4e7e6d2d4d7d5b1d2g8f6f1d3c7c5e4e5f6d7c2c3b8c6g1e2d8b6d2f3c5d4c3d4f7f6e5f6d7f6.
e2e4e7e6d2d4d7d5e4d5e6d5f1d3f8d6d1e2g8e7g1f3e8g8e1g1c8g4d3h7g8h8h7d3d8c8e2e3f7f6.
e2e4e7e6d2d4d7d5e4e5c7c5c2c3b8c6g1f3c8d7f1e2g8e7e1g1e7g6c1e3c5d4c3d4f8e7b1c3e8g8.
e2e4e7e6d2d4d7d5e4e5c7c5c2c3b8c6g1f3d8b6a2a3c5c4b1d2c6a5g2g3c8d7h2h4h7h6f1h3e8c8.
e2e4e7e6d2d4d7d5e4e5c7c5c2c3b8c6g1f3d8b6d1b3b6b3a2b3c5d4c3d4c8d7f1e2g8e7e1g1e7f5.
e2e4e7e6d2d4d7d5e4e5c7c5c2c3b8c6g1f3g8e7b1a3c5d4c3d4e7f5a3c2d8b6f1d3f8b4e1f1b4e7.
e2e4e7e6d2d4d7d5e4e5c7c5c2c3b8c6g1f3g8e7f1d3c5d4c3d4e7f5d3f5e6f5b1c3c8e6h2h4h7h6.
e2e4e7e6d2d4d7d5e4e5f8b4b1c3b7b6d1g4b4f8c1g5d8d7f1b5b8c6g1f3h7h6g5d2c8b7e1g1a7a6.
e2e4g7g6d2d4f8g7b1c3d7d6c1e3a7a6a2a4b8d7g1f3g8f6f1e2e8g8e1g1b7b6h2h3c8b7f3d2e7e6.
e2e4g7g6d2d4f8g7c2c4d7d6b1c3b8c6c1e3e7e5d4d5c6e7d1d2f7f5f2f3g8f6f1d3a7a6h2h3f5f4.
e2e4g7g6d2d4f8g7g1f3d7d6b1c3a7a6a2a4b7b6f1c4e7e6e1g1b8d7h2h3c8b7c1e3g8e7d1d2h7h6.
e2e4g8f6b1c3d7d5e4e5f6e4c3e2e4c5d2d4c5e6f2f4g7g6c1e3e6g7d1d2b7b6h2h3e7e6g1f3c7c5.
e2e4g8f6b1c3e7e5g2g3f8c5f1g2e8g8d2d3f8e8g1e2b8c6e1g1c6d4h2h3c7c6g1h2d4e2d1e2d7d5.
e2e4g8f6e4e5f6d5d2d4d7d6c2c4d5b6f2f4d6e5f4e5b8c6c1e3c8f5b1c3e7e6g1f3f8e7d4d5e6d5.
e2e4g8f6e4e5f6d5d2d4d7d6c2c4d5b6g1f3c8g4f1e2d6e5c4c5e5e4c5b6e4f3e2f3g4f3d1f3a7b6.
e2e4g8f6e4e5f6d5d2d4d7d6g1f3b8c6c2c4d5b6e5e6f7e6h2h4e6e5d4d5c6d4f3d4e5d4f1d3d8d7.
e2e4g8f6e4e5f6d5d2d4d7d6g1f3b8c6c2c4d5b6f1e2c8g4e5d6c7d6d4d5g4f3e2f3c6e5f3e2g7g6.
e2e4g8f6e4e5f6d5d2d4d7d6g1f3c8g4e5d6e7d6f1e2f8e7e1g1e8g8h2h3g4h5c2c4d5b6c1e3b8c6.
e2e4g8f6e4e5f6d5d2d4d7d6g1f3c8g4f1e2e7e6c2c4d5b6e5d6c7d6b1c3f8e7e1g1e8g8c1f4a7a6.
e2e4g8f6e4e5f6d5d2d4d7d6g1f3c8g4f1e2e7e6e1g1f8e7c2c4d5b6b1c3e8g8c1e3a7a6e5d6c7d6.
e2e4g8f6e4e5f6d5d2d4d7d6g1f3c8g4f1e2e7e6e1g1f8e7c2c4d5b6b1c3e8g8c1e3d6d5c4c5g4f3.
e2e4g8f6e4e5f6d5d2d4d7d6g1f3c8g4f1e2e7e6e1g1f8e7h2h3g4h5c2c4d5b6b1c3b8d7e5d6c7d6.
e2e4g8f6e4e5f6d5d2d4d7d6g1f3c8g4f1e2e7e6e1g1f8e7h2h3g4h5c2c4d5b6b1c3e8g8c1e3d6d5.
e2e4g8f6e4e5f6d5d2d4d7d6g1f3d6e5f3e5b8d7f1c4e7e6d1g4h7h5g4e2d7e5d4e5c8d7e1g1d7c6.
e2e4g8f6e4e5f6d5d2d4d7d6g1f3d6e5f3e5e7e6d1f3d8f6f3g3h7h6b1c3d5b4f1b5c7c6b5a4b8d7.
e2e4g8f6e4e5f6d5d2d4d7d6g1f3d6e5f3e5e7e6d1h5g7g6h5f3d8e7b1c3b8d7f1c4d5c3e5d7e7d7.
e2e4g8f6e4e5f6d5d2d4d7d6g1f3d6e5f3e5g7g6f1c4c8e6c4b3f8g7c2c3c7c6e1g1b8d7e5d3e8g8.
e2e4g8f6e4e5f6d5d2d4d7d6g1f3d6e5f3e5g7g6f1c4c8e6d1e2f8g7e1g1e8g8c4b3c7c6f1d1b8d7.
e2e4g8f6e4e5f6d5d2d4d7d6g1f3d6e5f3e5g7g6g2g3f8g7f1g2e8g8e1g1c7c6f1e1c8f5c2c3b8d7.
e2e4g8f6e4e5f6d5d2d4d7d6g1f3g7g6f1c4d5b6c4b3f8g7b1d2e8g8h2h3a7a5a2a4d6e5d4e5b8a6.
e2e4g8f6e4e5f6d5d2d4d7d6g1f3g7g6f1e2f8g7e1g1e8g8c2c4d5b6b1c3b8c6e5d6c7d6c1e3c8g4.
f2f4c7c5g1f3g7g6e2e4f8g7f1e2b8c6e1g1d7d6d2d3e7e6b1a3g8e7c2c3e8g8c1e3a7a6d3d4c5d4.
f2f4d7d5b2b3c8g4g2g3g8f6f1g2c7c6g1f3g4f3g2f3g7g6.
f2f4d7d5c2c4d5c4b1a3e7e5f4e5f8a3d1a4b8c6a4a3c6e5.
f2f4d7d5e2e3g7g6c2c4g8f6b1c3f8g7g1f3e8g8d1b3d5c4f1c4b8c6f3e5c6e5f4e5f6d7c4f7g8h8.
f2f4d7d5e2e3g7g6g1f3f8g7d2d4g8f6f1d3e8g8b1d2c7c5c2c3b7b6d1e2c8b7f3e5d8c7e1g1b8c6.
f2f4d7d5g1f3g7g6d2d3g8f6g2g3b7b6f1g2c8b7e1g1f8g7d1e1e8g8h2h3b8c6g3g4d8d6e1f2e7e5.
f2f4d7d5g1f3g8f6e2e3g7g6b2b3f8g7c1b2e8g8f1e2c7c5c2c4d5d4e3d4f6h5.
f2f4d7d5g1f3g8f6e2e3g7g6b2b3f8g7c1b2e8g8f1e2c7c5e1g1b8c6f3e5d8c7b1c3c6e5c3b5c7b6.
f2f4d7d5g1f3g8f6e2e3g7g6b2b3f8g7c1b2e8g8f1e2c7c5e1g1b8c6f3e5d8c7e5c6c7c6e2f3c8e6.
f2f4d7d5g1f3g8f6e2e3g7g6b2b4f8g7c1b2e8g8f1e2b7b6e1g1c8b7b1a3b8d7c2c4c7c5b4c5d7c5.
f2f4d7d5g2g3g8f6f1g2c7c5g1f3b8c6c2c3g7g6e1g1f8g7d2d3e8g8b1d2d8c7.
g1f3c7c5b2b3d7d5c1b2f7f6c2c4d5d4d2d3e7e5e2e3g8e7f1e2e7c6b1d2f8e7e1g1e8g8e3e4a7a6.
g1f3c7c5b2b3g8f6c2c4g7g6c1b2f8g7e2e3e8g8f1e2b7b6e1g1c8b7a2a3b8c6d2d3d7d5c4d5d8d5.
g1f3c7c5c2c4b8c6b1c3e7e5e2e3g8f6a2a3d7d6f1e2g7g6d2d4e5d4e3d4f8g7c1f4e8g8e1g1c8f5.
g1f3c7c5c2c4b8c6b1c3g8f6d2d4c5d4f3d4e7e6a2a3c6d4d1d4b7b6c1f4f8c5d4d2e8g8a1d1c8b7.
g1f3c7c5c2c4b8c6b1c3g8f6g2g3g7g6f1g2f8g7e1g1e8g8d2d3a7a6a2a3a8b8a1b1b7b5c4b5a6b5.
g1f3c7c5c2c4b8c6d2d4c5d4f3d4g8f6b1c3e7e6d4b5d7d5c1f4e6e5c4d5e5f4d5c6b7c6d1d8e8d8.
g1f3c7c5c2c4b8c6d2d4c5d4f3d4g8f6g2g3d8b6d4c2d7d6f1g2g7g6b1c3f8g7e1g1e8g8b2b3c8e6.
g1f3c7c5e2e4d7d6d2d4c5d4f3d4g8f6b1c3a7a6f1e2e7e5d4b3c8e6e1g1f8e7f2f4d8c7e2f3e8g8.
g1f3c7c5g2g3d7d5f1g2b8c6e1g1e7e6d2d3f8d6e2e4g8e7f1e1e8g8b1d2d6c7c2c3a7a5a2a4b7b6.
g1f3c7c5g2g3d7d6f1g2b8c6e1g1g8f6d2d3g7g6b2b3f8g7c1b2e8g8b1d2d8c7c2c4f8e8d2e4f6e4.
g1f3c7c5g2g3g7g6f1g2b8c6e1g1f8g7d2d3d7d6b1c3e7e5e2e4g8e7f3h4e8g8f2f4e5f4g3f4f7f5.
g1f3c7c5g2g3g7g6f1g2f8g7e1g1b8c6d2d3g8f6b1c3e8g8a2a3d7d6a1b1b7b6b2b4c8b7c1g5d8d7.
g1f3d7d5b2b3c8g4e2e3g8f6c1b2e7e6h2h3g4h5d2d3c7c5g2g4h5g6f3e5b8d7e5g6h7g6f1g2d8b6.
g1f3d7d5c2c4c7c6d2d4g8f6b1c3d5c4a2a4c8f5f3e5e7e6f2f3f8b4e5c4e8g8c1g5h7h6g5h4c6c5.
g1f3d7d5c2c4c7c6e2e3e7e6d2d4f7f5f1d3g8f6e1g1f8d6b2b3d8e7a2a4e8g8c1a3d6a3b1a3f6e4.
g1f3d7d5c2c4c7c6e2e3g8f6b1c3g7g6d2d4f8g7f1e2e8g8e1g1d5c4e2c4c8g4h2h3g4f3d1f3b8d7.
g1f3d7d5c2c4c7c6e2e3g8f6b1c3g7g6d2d4f8g7f1e2e8g8e1g1d5c4e2c4c8g4h2h3g4f3d1f3b8d7.
g1f3d7d5c2c4c7c6e2e3g8f6b1c3g7g6d2d4f8g7f1e2e8g8e1g1d5c4e2c4c8g4h2h3g4f3d1f3b8d7.
g1f3d7d5c2c4c7c6e2e3g8f6b1c3g7g6d2d4f8g7f1e2e8g8e1g1d5c4e2c4c8g4h2h3g4f3d1f3b8d7.
g1f3d7d5c2c4c7c6e2e3g8f6d2d4c8f5b1c3e7e6f3h4f5e4d1b3d8c7f2f3e4g6c1d2b8d7a1c1a8c8.
g1f3d7d5c2c4d5c4e2e3g8f6f1c4e7e6e1g1c7c5d2d4a7a6d1e2b7b5c4b3c8b7b1c3b8d7f1d1f8d6.
g1f3d7d5c2c4d5c4e2e3g8f6f1c4e7e6e1g1c7c5d2d4a7a6d1e2b7b5c4b3c8b7f1d1b8d7b1c3b5b4.
g1f3d7d5c2c4d5d4e2e3b8c6e3d4c6d4f3d4d8d4b1c3g8f6d2d3c7c6c1e3d4d7d3d4g7g6f1e2f8g7.
g1f3d7d5c2c4d5d4g2g3c7c5e2e3b8c6e3d4c6d4f3d4d8d4b1c3c8g4f1e2g4e2d1e2e7e6d2d3d4d7.
g1f3d7d5c2c4e7e6d2d4g8f6b1c3c7c5c4d5f6d5e2e4d5c3b2c3c5d4c3d4f8b4c1d2b4d2d1d2e8g8.
g1f3d7d5c2c4e7e6d2d4g8f6b1c3c7c5c4d5f6d5g2g3c5d4c3d5d8d5d1d4d5d4f3d4f8b4c1d2b4d2.
g1f3d7d5c2c4e7e6g2g3d5d4f1g2c7c5e1g1b8c6d2d3g8f6e2e3f8e7e3d4c5d4f1e1f6d7b1a3d7c5.
g1f3d7d5c2c4e7e6g2g3g8f6f1g2d5c4d1a4b8d7a4c4c7c5e1g1f8e7d2d3e8g8b2b3a7a6c1b2b7b5.
g1f3d7d5d2d4c7c5c2c4e7e6c4d5e6d5g2g3b8c6f1g2g8f6e1g1f8e7b1c3e8g8c1g5c8e6d4c5e7c5.
g1f3d7d5d2d4c7c5g2g3c5d4f1g2d8a5b1d2b8c6e1g1e7e5d2b3a5c7e2e3d4e3c1e3g8f6e3g5c8e6.
g1f3d7d5d2d4c7c6c2c4e7e6b1d2g8f6e2e3b8d7f1d3f8d6e3e4d5e4d2e4f6e4d3e4e8g8e1g1h7h6.
g1f3d7d5d2d4c7c6c2c4e7e6b1d2g8f6e2e3c6c5b2b3b8c6c1b2c5d4e3d4f8e7a1c1e8g8f1d3c8d7.
g1f3d7d5d2d4c8f5c2c4e7e6e2e3b8c6c4d5e6d5f1b5f8d6b1c3g8e7e1g1e8g8a2a3a7a6b5e2d8d7.
g1f3d7d5d2d4c8g4c2c4b8c6e2e3e7e5d1b3g4f3g2f3e5d4c4d5c6e5e3d4e5d7b1c3d8e7c1e3e7b4.
g1f3d7d5d2d4c8g4c2c4b8c6e2e3e7e5d1b3g4f3g2f3g8e7b1c3e5d4c3d5a8b8e3e4e7g6c1d2f8d6.
g1f3d7d5d2d4c8g4c2c4b8c6e2e3e7e6b1c3f8b4c1d2g8e7f1d3g4f5d3f5e7f5c4d5e6d5d1b3b4c3.
g1f3d7d5d2d4c8g4c2c4g4f3g2f3d5c4e2e4e7e5d4e5d8d1e1d1b8c6f3f4a8d8c1d2f8c5h1g1g8e7.
g1f3d7d5d2d4c8g4c2c4g4f3g2f3e7e6c4d5d8d5e2e4f8b4b1c3d5a5c1d2b8c6d4d5e6d5a2a3c6d4.
g1f3d7d5d2d4c8g4f3e5g4h5d1d3d8c8c2c4f7f6e5f3e7e6b1c3h5g6d3d1c7c6e2e3f8d6c1d2g8e7.
g1f3d7d5d2d4e7e6c2c4f8e7b1c3g8f6c1g5b8d7e2e3h7h6g5h4e8g8a1c1c7c6f1d3d5c4d3c4a7a6.
g1f3d7d5d2d4e7e6c2c4g8f6b1c3f8e7c1g5b8d7e2e3h7h6g5h4e8g8a1c1c7c6f1d3d5c4d3c4b7b5.
g1f3d7d5d2d4e7e6c2c4g8f6b1c3f8e7c1g5e8g8e2e3b7b6a1c1c8b7f1e2b8d7c4d5f6d5c3d5b7d5.
g1f3d7d5d2d4e7e6c2c4g8f6c1g5f8e7b1c3e8g8a1c1h7h6g5h4b7b6c4d5f6d5c3d5e6d5h4e7d8e7.
g1f3d7d5d2d4e7e6g2g3c7c5f1g2b8c6e1g1g8f6c2c4d5c4f3e5c8d7b1a3c5d4a3c4f8c5d1b3e8g8.
g1f3d7d5d2d4e7e6g2g3g8f6f1g2f8e7c2c4e8g8d1c2b8c6e1g1c6b4c2d1d5c4b1a3c7c5a3c4.
g1f3d7d5d2d4g8f6c2c4c7c6b1c3d5c4a2a4c8f5e2e3e7e6f1c4f8b4e1g1e8g8d1e2c6c5f1d1b8c6.
g1f3d7d5d2d4g8f6c2c4c7c6b1c3d5c4a2a4c8f5f3e5e7e6f2f3c6c5e2e4c5d4e4f5b8c6e5c6b7c6.
g1f3d7d5d2d4g8f6c2c4c7c6b1c3e7e6c1g5h7h6g5f6d8f6e2e3b8d7f1d3d5c4d3c4g7g6e1g1f8g7.
g1f3d7d5d2d4g8f6c2c4c7c6b1c3e7e6c1g5h7h6g5f6d8f6e2e3b8d7f1d3d5c4d3c4g7g6e1g1f8g7.
g1f3d7d5d2d4g8f6c2c4c7c6b1c3e7e6c4d5e6d5d1c2g7g6c1g5f8e7g5f6e7f6e2e3c8f5f1d3f5d3.
g1f3d7d5d2d4g8f6c2c4c7c6b1c3e7e6c4d5e6d5d1c2g7g6c1g5f8e7g5f6e7f6e2e3c8f5f1d3f5d3.
g1f3d7d5d2d4g8f6c2c4c7c6b1c3e7e6c4d5e6d5d1c2g7g6c1g5f8e7g5f6e7f6e2e3c8f5f1d3f5d3.
g1f3d7d5d2d4g8f6c2c4c7c6b1c3e7e6e2e3b8d7d1c2b7b6c1d2c8b7c4d5e6d5f1d3f8e7e1g1e8g8.
g1f3d7d5d2d4g8f6c2c4c7c6b1c3e7e6e2e3b8d7f1e2d5c4a2a4f8d6f3d2e8g8d2c4d6c7b2b3f6d5.
g1f3d7d5d2d4g8f6c2c4c7c6e2e3g7g6b1c3f8g7f1d3e8g8h2h3c6c5e1g1c5d4e3d4d5c4d3c4b8c6.
g1f3d7d5d2d4g8f6c2c4d5c4b1c3a7a6e2e4b7b5e4e5f6d5a2a4d5b4f1e2c8f5e1g1b4c2a1a2c2b4.
g1f3d7d5d2d4g8f6c2c4d5c4e2e3e7e6f1c4c7c5e1g1a7a6a2a4b8c6b1c3c5d4e3d4f8e7c1g5e8g8.
g1f3d7d5d2d4g8f6c2c4d5c4e2e3e7e6f1c4c7c5e1g1a7a6d1e2b7b5c4b3c8b7f1d1b8d7b1c3d8b8.
g1f3d7d5d2d4g8f6c2c4e7e6b1c3b8d7c1g5h7h6g5h4f8e7e2e3e8g8a1c1a7a6b2b3b7b6c4d5e6d5.
g1f3d7d5d2d4g8f6c2c4e7e6b1c3b8d7c4d5e6d5c1f4c7c6e2e3f8e7h2h3d7f8f1d3f8g6f4h2e8g8.
g1f3d7d5d2d4g8f6c2c4e7e6b1c3c7c6e2e3b8d7d1c2f8d6e3e4e6e5c4d5c6d5e4d5e5d4f3d4e8g8.
g1f3d7d5d2d4g8f6c2c4e7e6b1c3c7c6e2e3b8d7f1d3d5c4d3c4b7b5c4e2c8b7a2a3b5b4c3a4b4a3.
g1f3d7d5d2d4g8f6c2c4e7e6b1c3d5c4e2e4f8b4c1g5c7c5f1c4c5d4f3d4b4c3b2c3d8a5g5f6a5c3.
g1f3d7d5d2d4g8f6c2c4e7e6b1c3f8e7c1g5e8g8e2e3h7h6g5h4b7b6c4d5f6d5h4e7d8e7c3d5e6d5.
g1f3d7d5d2d4g8f6c2c4e7e6b1c3f8e7c1g5e8g8e2e3h7h6g5h4b7b6f1e2c8b7h4f6e7f6c4d5e6d5.
g1f3d7d5d2d4g8f6c2c4e7e6b1c3f8e7c1g5h7h6g5f6e7f6d1d2b8c6e2e3e8g8a1c1a7a6f1e2d5c4.
g1f3d7d5d2d4g8f6c2c4e7e6b1c3f8e7c1g5h7h6g5f6e7f6d1d2d5c4e2e4c7c5d4d5e6d5e4e5f6g5.
g1f3d7d5d2d4g8f6c2c4e7e6b1c3f8e7c1g5h7h6g5f6e7f6e2e3e8g8d1c2c7c5d4c5d5c4f1c4d8a5.
g1f3d7d5d2d4g8f6c2c4e7e6b1c3f8e7c1g5h7h6g5h4e8g8a1c1d5c4e2e3c7c5f1c4c5d4f3d4c8d7.
g1f3d7d5d2d4g8f6c2c4e7e6b1c3f8e7c1g5h7h6g5h4e8g8e2e3b7b6a1c1c8b7f1e2b8d7c4d5e6d5.
g1f3d7d5d2d4g8f6c2c4e7e6b1c3f8e7c1g5h7h6g5h4e8g8e2e3b7b6a1c1c8b7f1e2b8d7c4d5e6d5.
g1f3d7d5d2d4g8f6c2c4e7e6b1c3f8e7c1g5h7h6g5h4e8g8e2e3b7b6f1e2c8b7e1g1b8d7a1c1c7c5.
g1f3d7d5d2d4g8f6c2c4e7e6c1g5f8e7b1c3h7h6g5f6e7f6e2e3e8g8a1c1c7c6f1d3b8d7e1g1d5c4.
g1f3d7d5d2d4g8f6c2c4e7e6c1g5f8e7b1c3h7h6g5h4e8g8e2e3b7b6f1e2c8b7h4f6e7f6c4d5e6d5.
g1f3d7d5d2d4g8f6c2c4e7e6g2g3c7c5f1g2b8c6e1g1c5d4f3d4f8c5d4c6b7c6b1c3e8g8c1g5h7h6.
g1f3d7d5d2d4g8f6c2c4e7e6g2g3f8e7f1g2e8g8e1g1b8d7d1c2c7c6b2b3b7b6f1d1c8b7b1c3d8c8.
g1f3d7d5d2d4g8f6e2e3e7e6c2c4f8e7b1c3b8d7c4c5c7c6b2b4e8g8c1b2d8c7f1e2f6e8e1g1f7f5.
g1f3d7d5d2d4g8f6e2e3e7e6c2c4f8e7b1c3e8g8f1d3c7c5c4d5c5d4f3d4f6d5c3d5d8d5e1g1b8c6.
g1f3d7d5g2g3c7c5f1g2b8c6d2d4e7e6e1g1c5d4f3d4f8c5d4b3c5b6c2c4g8f6c4d5f6d5b1a3e8g8.
g1f3d7d5g2g3c7c6f1g2b8d7e1g1g8f6d2d3e7e5e2e4d5e4d3e4f6e4f3e5d7e5d1d8e8d8g2e4f8d6.
g1f3d7d5g2g3c7c6f1g2c8g4c2c4g8f6c4d5g4f3g2f3c6d5d2d3b8c6e1g1e7e6b1c3f8e7f3g2e8g8.
g1f3d7d5g2g3c7c6f1g2c8g4e1g1b8d7d2d4g4f3g2f3g8f6c1f4d8b6b2b3e7e6e2e3f8e7c2c4h7h6.
g1f3d7d5g2g3c7c6f1g2g8f6e1g1c8g4c2c4e7e6c4d5g4f3g2f3c6d5b1c3b8c6d2d3f8e7f3g2e8g8.
g1f3d7d5g2g3c8g4b2b3b8d7c1b2e7e6f1g2g8f6e1g1c7c6d2d3f8d6b1d2e8g8h2h3g4h5e2e3h7h6.
g1f3d7d5g2g3c8g4f1g2b8d7c2c4c7c6c4d5c6d5b1c3g8f6d1b3d7c5b3b5f6d7d2d4a7a6b5b4c5e4.
g1f3d7d5g2g3c8g4f1g2b8d7e1g1c7c6d2d3e7e5h2h3g4h5c2c4d5c4d3c4g8f6c1e3d8c7b1c3f8b4.
g1f3d7d5g2g3c8g4f1g2b8d7h2h3g4f3g2f3c7c6d2d3e7e6e2e4d7e5f3g2d5e4g2e4g8f6e4g2f8b4.
g1f3d7d5g2g3c8g4f1g2c7c6b2b3b8d7c1b2g8f6e1g1e7e6d2d3f8c5b1d2e8g8e2e4d5e4d3e4e6e5.
g1f3d7d5g2g3g7g6d2d4f8g7f1g2g8f6b1c3e8g8e1g1b8d7c1g5c7c6d1c1f6e4c3e4d5e4f3d2h7h6.
g1f3d7d5g2g3g7g6f1g2f8g7c2c4d5c4b1a3c8e6d1c2c7c5a3c4b8c6e1g1a8c8d2d3g8h6c4e5c6e5.
g1f3d7d5g2g3g7g6f1g2f8g7e1g1e7e5d2d3g8e7b1d2e8g8e2e4b8c6e4d5e7d5c2c3h7h6d2c4f8e8.
g1f3d7d5g2g3g8f6f1g2c7c6e1g1c8g4d2d3b8d7b1d2e7e6e2e4f8e7d1e2e8g8h2h3g4h5f1e1d5e4.
g1f3d7d5g2g3g8f6f1g2c8f5c2c4e7e6e1g1f8e7b2b3e8g8c1b2h7h6d2d3f5h7b1d2b8c6a2a3a7a5.
g1f3d7d6b1c3g8f6d2d4c8g4c1g5b8d7e2e4e7e5f1e2f8e7e1g1e8g8d1d2c7c6a2a4a7a5g5e3f8e8.
g1f3d7d6d2d4c8g4e2e3g8f6c2c4b8d7b1c3e7e5f1e2f8e7e3e4c7c6c1e3e8g8e1g1a7a6a2a3f8e8.
g1f3d7d6d2d4c8g4e2e4e7e6f1d3g8f6b1d2f8e7h2h3g4h5d2f1d6d5f1g3h5g6d1e2d5e4g3e4e8g8.
g1f3d7d6d2d4g8f6g2g3g7g6f1g2f8g7e1g1e8g8c2c4b8c6b1c3a7a6h2h3c8d7e2e4e7e5d4e5d6e5.
g1f3e7e6c2c4d7d5d2d4d5c4b1c3a7a6e2e3b7b5a2a4b5b4c3b1g8f6f1c4c8b7e1g1c7c5b1d2c5d4.
g1f3e7e6g2g3d7d5f1g2c7c5c2c4d5c4f3e5g8f6e1g1f8e7b1a3e8g8a3c4f6d5d2d4c5d4d1d4f7f6.
g1f3e7e6g2g3d7d5f1g2c7c5e1g1b8c6d2d3g7g6e2e4f8g7d1e2g8e7e4e5d8c7f1e1a7a6c2c3c8d7.
g1f3f7f5d2d4e7e6c2c4g8f6b1c3f8e7d4d5e6d5c4d5e8g8g2g3d7d6f1g2b8d7e1g1d7e5f3d4e5g6.
g1f3f7f5d2d4e7e6c2c4g8f6e2e3f8e7b1c3e8g8f1d3d7d5c1d2c7c6c4c5b8d7f3g5d7b8f2f3d8c7.
g1f3f7f5d2d4g8f6c1f4g7g6e2e3f8g7h2h3c7c5c2c3b7b6b1d2e8g8f1d3c8a6d1b3g8h8d3a6b8a6.
g1f3f7f5g2g3g8f6f1g2g7g6c2c4f8g7b1c3e8g8e1g1d7d6d2d4b8c6d4d5c6a5d1d3c7c5f3g5a7a6.
g1f3g7g6c2c4f8g7d2d4d7d6b1c3b8d7e2e4e7e6f1e2b7b6e1g1c8b7c1e3g8e7d1c2h7h6a1d1e8g8.
g1f3g7g6c2c4f8g7d2d4g8f6g2g3e8g8f1g2d7d6b1c3c7c6e1g1c8f5f3h4f5d7e2e4e7e5h4f3f8e8.
g1f3g7g6d2d4f8g7c2c4d7d6b1c3b8d7e2e4e7e5f1e2c7c6e1g1d8e7c1e3g8h6h2h3f7f6a1c1e8g8.
g1f3g7g6d2d4f8g7c2c4d7d6b1c3c8g4g2g3b8c6d4d5c6a5c1d2c7c5b2b3g8f6f1g2e8g8e1g1a7a6.
g1f3g7g6d2d4g8f6g2g3f8g7f1g2d7d5c2c4d5c4b1a3b8c6a3c4c8e6b2b3e8g8c1b2e6d5a1c1a7a5.
g1f3g7g6e2e4f8g7d2d4d7d6c2c4c8g4f1e2b8c6c1e3e7e5d4d5g4f3e2f3c6d4e3d4e5d4b1a3g8e7.
g1f3g8f6b2b3d7d5c1b2c8g4e2e3b8d7h2h3g4h5d2d3e7e6g2g4h5g6f3h4f8b4c2c3b4d6h4g6h7g6.
g1f3g8f6b2b3g7g6c1b2f8g7g2g3e8g8f1g2d7d6d2d4c7c5c2c4c5d4f3d4a7a6b1c3e7e6e1g1d8c7.
g1f3g8f6c2c4b7b6b1c3c8b7d2d3c7c5e2e4d7d6g2g3e7e6f1g2f8e7e1g1e8g8b2b3a7a6c1b2f8e8.
g1f3g8f6c2c4b7b6d2d3g7g6e2e4d7d6b1c3f8g7d3d4e8g8f1e2c8b7d1c2e7e5d4e5d6e5c1e3f8e8.
g1f3g8f6c2c4b7b6d2d4e7e6g2g3c8a6b2b3f8b4c1d2b4e7f1g2e8g8e1g1d7d5c4d5f6d5b1c3b8d7.
g1f3g8f6c2c4b7b6e2e3c8b7f1e2e7e6e1g1f8e7b2b3e8g8c1b2c7c5b1c3b8c6a2a3d7d5c4d5f6d5.
g1f3g8f6c2c4b7b6g2g3c7c5f1g2c8b7b1c3g7g6d2d3f8g7e2e4b8c6e1g1e8g8f3h4c6d4e4e5b7g2.
g1f3g8f6c2c4b7b6g2g3c7c5f1g2c8b7b1c3g7g6d2d3f8g7e2e4e8g8h2h3f6e8c1e3e7e5e1g1d7d6.
g1f3g8f6c2c4b7b6g2g3c7c5f1g2c8b7b1c3g7g6e1g1f8g7d2d3e8g8e2e4d7d6a1b1b8c6a2a3f6e8.
g1f3g8f6c2c4b7b6g2g3c7c5f1g2c8b7e1g1e7e6b1c3f8e7d2d4c5d4d1d4d7d6b2b3b8d7c3b5d7c5.
g1f3g8f6c2c4b7b6g2g3c7c5f1g2c8b7e1g1e7e6b1c3f8e7d2d4c5d4d1d4d7d6c1e3e8g8a1d1b8d7.
g1f3g8f6c2c4b7b6g2g3c7c5f1g2c8b7e1g1g7g6b1c3f8g7d2d4c5d4f3d4b7g2g1g2e8g8e2e4d8c7.
g1f3g8f6c2c4b7b6g2g3c7c5f1g2c8b7e1g1g7g6b1c3f8g7d2d4c5d4f3d4b7g2g1g2e8g8e2e4d8c7.
g1f3g8f6c2c4b7b6g2g3c7c5f1g2c8b7e1g1g7g6b2b3f8g7c1b2e8g8e2e3e7e6d2d4d8e7b1c3b8a6.
g1f3g8f6c2c4b7b6g2g3c7c5f1g2c8b7e1g1g7g6d2d4c5d4d1d4f8g7b1c3d7d6f1d1b8d7b2b3a8c8.
g1f3g8f6c2c4b7b6g2g3c7c5f1g2c8b7e1g1g7g6d2d4c5d4d1d4f8g7b1c3d7d6f1d1b8d7b2b3a8c8.
g1f3g8f6c2c4b7b6g2g3c8b7f1g2c7c5b1c3g7g6e1g1f8g7d2d4c5d4d1d4b8c6d4f4a8c8f1d1d7d6.
g1f3g8f6c2c4b7b6g2g3c8b7f1g2c7c5e1g1g7g6b1c3f8g7d2d4c5d4f3d4b7g2g1g2d8c8b2b3c8b7.
g1f3g8f6c2c4b7b6g2g3c8b7f1g2e7e6b1c3f8e7d2d4f6e4c1d2e7f6e1g1e8g8a1c1e4d2d1d2d7d6.
g1f3g8f6c2c4b7b6g2g3c8b7f1g2e7e6e1g1f8e7b1c3e8g8b2b3d7d5c4d5f6d5c1b2c7c5a1c1e7f6.
g1f3g8f6c2c4b7b6g2g3c8b7f1g2e7e6e1g1f8e7b1c3e8g8d2d4f6e4c1d2e7f6d1c2e4d2c2d2d7d6.
g1f3g8f6c2c4b7b6g2g3c8b7f1g2e7e6e1g1f8e7b1c3e8g8f1e1d7d5c4d5e6d5d2d4b8a6c1g5c7c6.
g1f3g8f6c2c4b7b6g2g3c8b7f1g2e7e6e1g1f8e7d2d4e8g8b1c3f6e4d1c2e4c3c2c3f7f5b2b3e7f6.
g1f3g8f6c2c4b7b6g2g3c8b7f1g2e7e6e1g1f8e7d2d4e8g8b1c3f6e4d1c2e4c3c2c3f7f5b2b3e7f6.
g1f3g8f6c2c4b7b6g2g3c8b7f1g2e7e6e1g1f8e7d2d4e8g8d4d5e6d5f3d4b7c6c4d5c6d5g2d5f6d5.
g1f3g8f6c2c4b7b6g2g3c8b7f1g2e7e6e1g1f8e7d2d4e8g8d4d5e6d5f3d4b8c6c4d5c6d4d1d4c7c5.
g1f3g8f6c2c4b7b6g2g3c8b7f1g2g7g6b1c3f8g7d2d4f6e4c3e4b7e4e1g1e8g8d4d5c7c5g2h3e4f3.
g1f3g8f6c2c4b7b6g2g3c8b7f1g2g7g6e1g1f8g7d2d4e7e6b1c3f6e4c3e4b7e4c1g5f7f6g5e3e8g8.
g1f3g8f6c2c4b7b6g2g3e7e6f1g2c8b7e1g1f8e7d2d4e8g8d4d5e6d5f3h4c7c6c4d5f6d5h4f5e7c5.
g1f3g8f6c2c4c7c5b1c3b8c6d2d4c5d4f3d4e7e6a2a3c6d4d1d4b7b6c1f4f8c5d4d2c8b7e2e3e8g8.
g1f3g8f6c2c4c7c5b1c3b8c6d2d4c5d4f3d4e7e6a2a3c6d4d1d4b7b6d4f4c8b7e2e4d7d6c1e3f8e7.
g1f3g8f6c2c4c7c5b1c3b8c6d2d4c5d4f3d4e7e6a2a3c6d4d1d4b7b6d4f4c8b7e2e4d7d6f1d3f8e7.
g1f3g8f6c2c4c7c5b1c3b8c6d2d4c5d4f3d4e7e6a2a3f8e7e2e3d7d5c4d5e6d5f1b5c8d7d4f3a7a6.
g1f3g8f6c2c4c7c5b1c3b8c6d2d4c5d4f3d4e7e6d4b5d7d5c1f4e6e5c4d5e5f4d5c6b7c6d1d8e8d8.
g1f3g8f6c2c4c7c5b1c3b8c6d2d4c5d4f3d4e7e6g2g3d8b6d4b3d7d5c4d5f6d5f1g2d5c3b2c3f8e7.
g1f3g8f6c2c4c7c5b1c3b8c6d2d4c5d4f3d4e7e6g2g3d8b6d4b3d7d5c4d5f6d5f1g2d5c3b2c3f8e7.
g1f3g8f6c2c4c7c5b1c3b8c6d2d4c5d4f3d4e7e6g2g3d8b6d4b5c6e5f1g2a7a6d1a4a8b8c1e3f8c5.
g1f3g8f6c2c4c7c5b1c3b8c6g2g3d7d5c4d5f6d5f1g2d5c7d2d3e7e5f3d2c8d7e1g1f8e7d2c4f7f6.
g1f3g8f6c2c4c7c5b1c3b8c6g2g3d7d5c4d5f6d5f1g2d5c7e1g1e7e5f3e1c8e6e1d3f7f6f2f4c5c4.
g1f3g8f6c2c4c7c5b1c3b8c6g2g3g7g6f1g2f8g7e1g1e8g8d2d4c5d4f3d4c6d4d1d4d7d6d4d3a7a6.
g1f3g8f6c2c4c7c5b1c3d7d5c4d5f6d5d2d4d5c3b2c3g7g6e2e3f8g7f1d3e8g8e1g1d8c7a2a4b8c6.
g1f3g8f6c2c4c7c5b1c3d7d5c4d5f6d5e2e4d5b4f1b5b8c6d2d4c5d4a2a3d4c3d1d8e8d8a3b4c3b2.
g1f3g8f6c2c4c7c5b1c3d7d5c4d5f6d5e2e4d5b4f1c4b4d3e1e2d3f4e2f1f4e6b2b4c5b4c3d5g7g6.
g1f3g8f6c2c4c7c5b1c3e7e6g2g3b7b6f1g2c8b7e1g1f8e7b2b3e8g8c1b2d7d5c4d5f6d5d2d4b8a6.
g1f3g8f6c2c4c7c5b1c3e7e6g2g3b7b6f1g2c8b7e1g1f8e7d2d4c5d4d1d4d7d6c1g5a7a6g5f6e7f6.
g1f3g8f6c2c4c7c5b1c3e7e6g2g3b7b6f1g2c8b7e1g1f8e7d2d4c5d4d1d4d7d6f1d1a7a6b2b3b8d7.
g1f3g8f6c2c4c7c5d2d4c5d4f3d4e7e6g2g3f8b4b1c3e8g8f1g2d7d5e1g1d5c4c1g5h7h6g5f6d8f6.
g1f3g8f6c2c4c7c5g2g3b7b6f1g2c8b7e1g1e7e6b1c3f8e7d2d4c5d4d1d4d7d6c1g5a7a6g5f6e7f6.
g1f3g8f6c2c4c7c5g2g3b8c6f1g2d7d5c4d5f6d5d2d4c8f5e1g1d5b4a2a3b4c2f3h4d8d4b1d2c2a1.
g1f3g8f6c2c4c7c5g2g3b8c6f1g2e7e5b1c3d7d6e1g1f8e7d2d3e8g8a2a3a7a6f3e1a8b8e1c2c6d4.
g1f3g8f6c2c4c7c5g2g3d7d5c4d5f6d5f1g2b8c6d2d4c5d4f3d4d5b4d4c6d8d1e1d1b4c6b1c3c8d7.
g1f3g8f6c2c4c7c5g2g3d7d5c4d5f6d5f1g2b8c6d2d4c5d4f3d4d5b4d4c6d8d1e1d1b4c6g2c6b7c6.
g1f3g8f6c2c4c7c5g2g3e7e6f1g2d7d5c4d5f6d5e1g1f8e7b1c3e8g8c3d5e6d5d2d4b8c6d4c5e7c5.
g1f3g8f6c2c4c7c5g2g3g7g6b2b3f8g7c1b2e8g8f1g2b8c6e1g1d7d6d2d4c5d4f3d4c8d7b1c3d8a5.
g1f3g8f6c2c4c7c6b1c3d7d5e2e3a7a6d2d4b7b5b2b3c8g4f1e2e7e6e1g1b8d7h2h3g4h5f3e5h5e2.
g1f3g8f6c2c4e7e6b1c3b7b6e2e4c8b7d2d3d7d6g2g3g7g6f1g2f8g7e1g1c7c5f1e1e8g8d3d4c5d4.
g1f3g8f6c2c4e7e6b1c3b7b6e2e4c8b7f1d3c7c5e1g1b8c6e4e5f6g4d3e4d8c8d2d4c5d4e4c6c8c6.
g1f3g8f6c2c4e7e6b1c3b7b6g2g3c8b7f1g2c7c5e1g1f8e7b2b3d7d6c1b2e8g8e2e3a7a6d2d4c5d4.
g1f3g8f6c2c4e7e6b1c3c7c5e2e4b8c6f1e2d7d5e4e5f6e4e1g1f8e7d1c2e4g5f3g5e7g5c4d5e6d5.
g1f3g8f6c2c4e7e6b1c3c7c5g2g3b8c6f1g2d7d5c4d5f6d5e1g1f8e7d2d4d5c3b2c3e8g8a1b1d8a5.
g1f3g8f6c2c4e7e6b1c3d7d5d2d4c7c5c4d5c5d4d1d4f6d5e2e4d5c3d4c3b8c6f1b5c8d7e1g1d8b6.
g1f3g8f6c2c4e7e6b1c3d7d5d2d4c7c5c4d5f6d5e2e3b8c6f1d3f8e7a2a3c5d4e3d4e8g8e1g1d5f6.
g1f3g8f6c2c4e7e6b1c3d7d5d2d4c7c5e2e3b8c6c4d5e6d5f1e2c5d4f3d4f8d6e1g1e8g8d4f3c8e6.
g1f3g8f6c2c4e7e6b1c3d7d5d2d4c7c5e2e3b8c6c4d5f6d5f1c4f8e7c4d5e6d5d4c5c8e6e1g1e7c5.
g1f3g8f6c2c4e7e6b1c3d7d5d2d4c7c6d1b3f8e7g2g3e8g8f1g2d8b6e1g1b6b3a2b3b8a6c1d2f8d8.
g1f3g8f6c2c4e7e6b1c3d7d5d2d4c7c6e2e3b8d7f1d3d5c4d3c4b7b5c4d3c8b7e3e4b5b4c3a4c6c5.
g1f3g8f6c2c4e7e6b1c3d7d5d2d4c7c6e2e3b8d7f1d3d5c4d3c4b7b5c4d3c8b7e3e4b5b4c3a4c6c5.
g1f3g8f6c2c4e7e6b1c3d7d5d2d4d5c4e2e3a7a6a2a4c7c5f1c4b8c6e1g1f8e7d4c5d8d1f1d1e7c5.
g1f3g8f6c2c4e7e6b1c3d7d5d2d4f8b4c4d5e6d5c1g5b8d7e2e3c7c5g5f6d7f6f1b5e8e7e1g1c5c4.
g1f3g8f6c2c4e7e6b1c3d7d5d2d4f8e7c1f4e8g8e2e3c7c5d4c5e7c5d1c2b8c6a2a3d8a5e1c1c5e7.
g1f3g8f6c2c4e7e6b1c3d7d5d2d4f8e7c1g5e8g8e2e3h7h6g5h4b7b6d1b3c8b7h4f6e7f6c4d5e6d5.
g1f3g8f6c2c4e7e6b1c3d7d5d2d4f8e7c1g5e8g8e2e3h7h6g5h4b7b6d1b3c8b7h4f6e7f6c4d5e6d5.
g1f3g8f6c2c4e7e6b1c3d7d5d2d4f8e7c1g5h7h6g5f6e7f6e2e3e8g8a1c1c7c6f1d3b8d7e1g1d5c4.
g1f3g8f6c2c4e7e6b1c3d7d5d2d4f8e7c1g5h7h6g5h4e8g8a1c1d5c4e2e3c7c5f1c4c5d4f3d4c8d7.
g1f3g8f6c2c4e7e6b1c3d7d5d2d4f8e7c1g5h7h6g5h4e8g8e2e3b7b6a1c1c8b7f1e2d5c4e2c4b8d7.
g1f3g8f6c2c4e7e6b1c3d7d5d2d4f8e7c1g5h7h6g5h4e8g8e2e3b7b6f1d3c8b7h4f6e7f6c4d5e6d5.
g1f3g8f6c2c4e7e6b1c3d7d5d2d4f8e7c1g5h7h6g5h4e8g8e2e3f6e4h4e7d8e7a1c1e4c3c1c3d5c4.
g1f3g8f6c2c4e7e6b1c3f8b4d1b3c7c5a2a3b4a5g2g3b8c6f1g2e8g8e1g1d7d5d2d3d5d4c3a4b7b6.
g1f3g8f6c2c4e7e6b1c3f8b4d1c2c7c5g2g3e8g8f1g2b8c6e1g1d8e7e2e3d7d5c3a4d5c4c2c4a8b8.
g1f3g8f6c2c4e7e6b1c3f8b4d1c2e8g8a2a3b4c3c2c3b7b6b2b4d7d6c1b2c8b7g2g3c7c5f1g2b8d7.
g1f3g8f6c2c4e7e6b1c3f8b4d1c2e8g8a2a3b4c3c2c3b7b6g2g3c8b7f1g2d7d5c4d5e6d5e1g1f8e8.
g1f3g8f6c2c4e7e6b1c3f8b4d1c2e8g8a2a3b4c3c2c3c7c5b2b4b7b6c1b2d7d6g2g3c8b7f1g2b8d7.
g1f3g8f6c2c4e7e6b1c3f8b4g2g3e8g8f1g2c7c5e1g1b8c6d2d4c5d4f3d4d8e7d4c2b4c3b2c3f8d8.
g1f3g8f6c2c4e7e6b1c3f8b4g2g3e8g8f1g2d7d5d1b3c7c5e1g1b8c6d2d3h7h6e2e3f8e8a2a3d5c4.
g1f3g8f6c2c4e7e6b1c3f8b4g2g4d7d5g4g5f6e4d1a4b8c6c3e4d5e4f3e5e4e3f2e3d8g5e5f3g5e7.
g1f3g8f6c2c4e7e6d2d4b7b6g2g3c8b7f1g2f8e7b1c3f6e4d1c2e4c3b2c3f7f5f3h4b8c6h4f3c6a5.
g1f3g8f6c2c4e7e6d2d4b7b6g2g3c8b7f1g2f8e7e1g1d7d6b1c3b8d7d1c2e8g8e2e4e6e5f1e1f8e8.
g1f3g8f6c2c4e7e6d2d4d7d5b1c3c7c5c4d5f6d5g2g3c5d4c3d5d8d5d1d4b8c6d4d5e6d5f1g2c8f5.
g1f3g8f6c2c4e7e6d2d4d7d5b1c3c7c6c1g5b8d7e2e3d8a5c4d5f6d5d1d2d7b6c3d5a5d2f3d2e6d5.
g1f3g8f6c2c4e7e6d2d4d7d5b1c3c7c6c1g5b8d7e2e3d8a5f3d2f8b4d1c2d5c4g5f6d7f6d2c4b4c3.
g1f3g8f6c2c4e7e6d2d4d7d5g2g3d5c4f1g2c7c5e1g1b8c6f3e5c8d7b1a3f6d5e5d7d8d7d4c5f8c5.
g1f3g8f6c2c4e7e6g2g3a7a6f1g2b7b5b2b3c7c5e1g1c8b7e2e3f8e7b1c3d8a5c1b2e8g8d1e2b8c6.
g1f3g8f6c2c4e7e6g2g3b7b6f1g2c8b7b1c3f8e7e1g1e8g8f1e1f6e4c3e4b7e4d2d3e4b7d3d4b7e4.
g1f3g8f6c2c4e7e6g2g3b7b6f1g2c8b7d2d4f8e7e1g1e8g8b1c3f6e4c3e4b7e4f3h4e4g2h4g2d7d6.
g1f3g8f6c2c4e7e6g2g3b7b6f1g2c8b7e1g1c7c5b1c3f8e7d2d4c5d4d1d4b8c6d4f4e8g8f1d1d8b8.
g1f3g8f6c2c4e7e6g2g3b7b6f1g2c8b7e1g1f8e7d2d4e8g8b1c3f6e4d1c2e4c3c2c3c7c5f1d1d7d6.
g1f3g8f6c2c4e7e6g2g3b7b6f1g2c8b7e1g1f8e7d2d4e8g8f1e1d7d5c4d5e6d5b1c3b8d7c1f4f6e4.
g1f3g8f6c2c4e7e6g2g3d7d5d2d4d5c4d1a4b8d7a4c4b7b6f1g2c8b7e1g1c7c5f1d1a7a6d4c5f8c5.
g1f3g8f6c2c4e7e6g2g3d7d5f1g2c7c5e1g1b8c6d2d4f6e4c4d5e6d5c1e3c5c4b1c3e4c3b2c3d8a5.
g1f3g8f6c2c4e7e6g2g3d7d5f1g2c7c6e1g1f8d6b2b3b8d7c1b2e8g8c4d5e6d5d2d3f8e8b1d2d7f8.
g1f3g8f6c2c4e7e6g2g3d7d5f1g2d5c4d1a4b8d7a4c4a7a6d2d3b7b5c4c6a8b8c1f4f6d5f4g5f8e7.
g1f3g8f6c2c4e7e6g2g3d7d5f1g2d5c4d1a4b8d7a4c4c7c5e1g1b7b6c4c2c8b7b2b3f8e7c1b2e8g8.
g1f3g8f6c2c4e7e6g2g3d7d5f1g2d5c4d1c2a7a6f3e5f6d5e5c4b7b5c4e3d5e3d2e3a8a7a2a4c8b7.
g1f3g8f6c2c4e7e6g2g3d7d5f1g2f8e7e1g1e8g8d2d4d5c4d1c2a7a6a2a4b8c6c2c4d8d5b1d2f8d8.
g1f3g8f6c2c4e7e6g2g3d7d5f1g2f8e7e1g1e8g8d2d4d5c4d1c2a7a6c1g5b7b5g5f6e7f6f3g5f6g5.
g1f3g8f6c2c4g7g6b1c3d7d5c4d5f6d5d1a4b8c6f3e5d5b6e5c6b6a4c6d8a4c3d8f7e8f7d2c3e7e5.
g1f3g8f6c2c4g7g6b1c3d7d5c4d5f6d5d1a4c8d7a4h4d5c3d2c3b8c6e2e4e7e5c1g5f8e7f1c4h7h6.
g1f3g8f6c2c4g7g6b1c3d7d5c4d5f6d5d1a4c8d7a4h4d5c3d2c3b8c6e2e4e7e5c1g5f8e7f1c4h7h6.
g1f3g8f6c2c4g7g6b1c3d7d5c4d5f6d5d1a4c8d7a4h4d5c3d2c3b8c6e2e4e7e5h4d8a8d8f1c4f7f6.
g1f3g8f6c2c4g7g6b1c3d7d5c4d5f6d5d1a4c8d7a4h4d7c6h4d4f7f6e2e3f8g7f1e2e7e5d4c4d5c3.
g1f3g8f6c2c4g7g6b1c3d7d5c4d5f6d5g2g3f8g7f1g2e7e5c3d5d8d5d2d3e8g8e1g1b8c6c1e3d5d6.
g1f3g8f6c2c4g7g6b1c3f8g7d2d4d7d6g2g3e8g8f1g2b8c6e1g1a8b8h2h3a7a6a2a4f6d7a4a5e7e5.
g1f3g8f6c2c4g7g6b1c3f8g7d2d4d7d6g2g3e8g8f1g2b8d7e1g1c7c6e2e4e7e5h2h3a7a5c1e3e5d4.
g1f3g8f6c2c4g7g6b1c3f8g7d2d4e8g8e2e4d7d6f1e2e7e5d4d5f6h5f3g1b8d7e2h5g6h5d1h5d7c5.
g1f3g8f6c2c4g7g6b1c3f8g7e2e4c7c5d2d4c5d4f3d4b8c6c1e3f6g4d1g4c6d4g4d1d4e6d1d2d8a5.
g1f3g8f6c2c4g7g6b1c3f8g7e2e4d7d6d2d4e8g8c1e3e7e5d4e5d6e5d1d8f8d8c3d5d8d7e1c1b8c6.
g1f3g8f6c2c4g7g6b1c3f8g7e2e4d7d6d2d4e8g8f1e2b8d7e1g1e7e5f1e1f8e8e2f1h7h6d4d5f6h7.
g1f3g8f6c2c4g7g6b1c3f8g7e2e4d7d6d2d4e8g8f1e2e7e5e1g1b8c6d4d5c6e7c1d2f6h5a1c1f7f5.
g1f3g8f6c2c4g7g6b1c3f8g7e2e4d7d6d2d4e8g8f1e2e7e5e1g1b8c6d4d5c6e7f3d2a7a5b2b3c7c5.
g1f3g8f6c2c4g7g6b1c3f8g7e2e4d7d6d2d4e8g8f1e2e7e5e1g1b8c6d4d5c6e7f3e1f6d7e1d3f7f5.
g1f3g8f6c2c4g7g6b1c3f8g7e2e4d7d6d2d4e8g8f1e2e7e5e1g1b8c6d4d5c6e7f3e1f6d7e1d3f7f5.
g1f3g8f6c2c4g7g6b1c3f8g7e2e4d7d6d2d4e8g8f1e2e7e5e1g1b8c6d4d5c6e7f3e1f6d7e1d3f7f5.
g1f3g8f6c2c4g7g6b2b3f8g7c1b2c7c5g2g3d7d6f1g2e7e5e1g1b8c6b1c3e8g8d2d3f6h5f3d2c8g4.
g1f3g8f6c2c4g7g6d2d4f8g7b1c3d7d6e2e4e8g8f1e2e7e5e1g1b8c6d4d5c6e7b2b4a7a5c1a3a5b4.
g1f3g8f6c2c4g7g6d2d4f8g7g2g3e8g8f1g2c7c6b1c3d7d5c4d5c6d5f3e5e7e6e1g1f6d7e5d7c8d7.
g1f3g8f6c2c4g7g6g2g3f8g7b1c3e8g8f1g2d7d6e1g1b8c6d2d3h7h6a2a3e7e5a1b1a7a5f3d2c6e7.
g1f3g8f6c2c4g7g6g2g3f8g7f1g2e8g8e1g1c7c5d2d4c5d4f3d4d7d5c4d5f6d5b1c3d5c3b2c3d8c7.
g1f3g8f6c2c4g7g6g2g3f8g7f1g2e8g8e1g1d7d6b1c3b8c6d2d3a7a6f3d2a8b8a2a3f6e8e2e3c8d7.
g1f3g8f6c2c4g7g6g2g3f8g7f1g2e8g8e1g1d7d6b1c3b8c6d2d3f6h5d3d4e7e5d4d5c6e7e2e4c7c5.
g1f3g8f6c2c4g7g6g2g3f8g7f1g2e8g8e1g1d7d6d2d4b8d7b1c3e7e5d4e5d6e5h2h3c7c6c1e3d8e7.
g1f3g8f6c2c4g7g6g2g3f8g7f1g2e8g8e1g1d7d6d2d4b8d7b1c3e7e5e2e4c7c6f1e1e5d4f3d4f6g4.
g1f3g8f6c2c4g7g6g2g3f8g7f1g2e8g8e1g1d7d6d2d4b8d7b1c3e7e5e2e4e5d4f3d4f8e8f1e1c7c6.
g1f3g8f6c2c4g7g6g2g3f8g7f1g2e8g8e1g1d7d6d2d4c7c5h2h3b8c6b1c3c8d7d4c5d6c5c1e3d8c8.
g1f3g8f6d2d4b7b6c1g5f6e4g5h4c8b7e2e3h7h6b1d2g7g5h4g3e4g3h2g3e7e6c2c3d7d6d1a4c7c6.
g1f3g8f6d2d4d7d5c2c4d5c4e2e3g7g6f1c4f8g7e1g1e8g8b2b3c7c6c1b2c8g4b1d2b8d7h2h3g4f5.
g1f3g8f6d2d4d7d5c2c4e7e6b1c3c7c6e2e3f8d6f1d3b8d7e1g1e8g8e3e4d5e4c3e4f6e4d3e4h7h6.
g1f3g8f6d2d4d7d5c2c4e7e6b1c3f8e7c1g5e8g8e2e3h7h6g5f6e7f6a1c1f6e7a2a3c7c6f1d3b8d7.
g1f3g8f6d2d4d7d6c2c4b8d7b1c3c7c6e2e4e7e5f1e2f8e7e1g1e8g8f1e1a7a6e2f1b7b5a2a3c8b7.
g1f3g8f6d2d4e7e6c1g5h7h6g5f6d8f6e2e4d7d6b1c3g7g5e4e5f6e7f1b5c8d7e1g1d6d5b5d3b8c6.
g1f3g8f6d2d4e7e6c2c4b7b6b1c3f8b4e2e3c7c5f1d3d7d5c4d5e6d5e1g1e8g8a2a3b4c3b2c3c8a6.
g1f3g8f6d2d4e7e6e2e3b7b6c2c4c8b7b1c3d7d5c4d5f6d5f1b5c7c6b5d3f8e7e3e4d5c3b2c3e8g8.
g1f3g8f6d2d4e7e6e2e3c7c5c2c4d7d5d4c5f8c5b1c3c5b4c1d2d5c4f1c4e8g8e1g1b8c6d1e2d8e7.
g1f3g8f6d2d4e7e6e2e3f8b4c2c3b4e7f1e2e8g8e1g1d7d5c3c4b7b6b1c3c8b7c4d5e6d5f3e5f6d7.
g1f3g8f6d2d4e7e6g2g3b7b6f1g2c8b7c2c4f8e7b1c3e8g8d1d3d7d5c4d5f6d5c3d5e6d5e1g1b8d7.
g1f3g8f6d2d4g7g6g2g3d7d5f1g2f8g7e1g1e8g8c2c4d5c4b1a3b8c6a3c4c8e6c4e5e6d5c1f4e7e6.
g1f3g8f6d2d4g7g6g2g3f8g7f1g2e8g8e1g1d7d6b1c3b8a6e2e4c7c5e4e5f6e8e5d6e8d6d4c5a6c5.
g1f3g8f6d2d4g7g6g2g3f8g7f1g2e8g8e1g1d7d6f1e1b8c6b1c3e7e5d4e5d6e5h2h3d8e7c1g5f8d8.
g1f3g8f6g2g3b7b5a2a4b5b4d2d3c8b7e2e4d7d6f1g2b8d7e1g1e7e6a4a5a8b8b1d2f8e7d2c4e8g8.
g1f3g8f6g2g3b7b6c2c4c7c5f1g2c8b7e1g1e7e6b1c3f8e7b2b3d7d5e2e3e8g8c1b2b8d7d1e2f6e4.
g1f3g8f6g2g3b7b6f1g2c8b7e1g1c7c5d2d3g7g6e2e4d7d6f3h4b8c6f2f4f8g7b1c3e8g8f4f5c6e5.
g1f3g8f6g2g3d7d5c2c4c7c6f1g2d5c4a2a4g7g6b1a3d8d5e1g1b8a6f3e1d5h5a3c4c8h3e1f3h3g2.
g1f3g8f6g2g3d7d5f1g2c7c5e1g1g7g6d2d3f8g7b1d2e8g8e2e4b8c6c2c3e7e5f1e1h7h6e4d5f6d5.
g1f3g8f6g2g3d7d5f1g2c7c6b2b3c8f5c1b2e7e6e1g1f8e7d2d3h7h6b1d2e8g8d1e1b8d7e2e4f5h7.
g1f3g8f6g2g3d7d5f1g2c7c6c2c4d5c4b1a3b7b5d2d3c4d3f3e5a7a6e1g1c8b7d1b3e7e6f1d1d8c7.
g1f3g8f6g2g3d7d5f1g2c7c6e1g1c8g4b2b3b8d7c1b2e7e6c2c4f8d6d2d3e8g8b1d2d8e7d1c2e6e5.
g1f3g8f6g2g3d7d5f1g2c7c6e1g1c8g4c2c4e7e6c4d5c6d5d1b3g4f3g2f3d8d7b1c3b8c6f3g2f8e7.
g1f3g8f6g2g3d7d5f1g2c7c6e1g1c8g4d2d3b8d7b1d2e7e5e2e4f8d6h2h3g4f3d1f3e8g8e4d5f6d5.
g1f3g8f6g2g3d7d5f1g2c8f5c2c4c7c6c4d5c6d5d1b3d8c8b1c3e7e6d2d3b8c6c1f4f8e7e1g1e8g8.
g1f3g8f6g2g3d7d5f1g2c8f5d2d3e7e6b1d2h7h6e1g1f8c5d1e1e8g8e2e4d5e4d2e4f6e4d3e4f5h7.
g1f3g8f6g2g3d7d5f1g2c8f5e1g1b8d7d2d3c7c6b1d2h7h6e2e4d5e4d3e4f6e4f3d4e4d2c1d2f5h7.
g1f3g8f6g2g3d7d5f1g2g7g6c2c4c7c6b2b3f8g7c1b2e8g8e1g1c8g4d2d4f6e4f3e5g4e6f2f3e4d6.
g1f3g8f6g2g3d7d6f1g2e7e5d2d3g7g6e1g1f8g7e2e4e8g8b1d2b8d7a2a4a7a5d2c4d7c5c1e3c5e6.
g1f3g8f6g2g3g7g6b2b3f8g7c1b2d7d5c2c4c8g4f1g2c7c6e1g1e8g8d2d3g4f3g2f3b8d7b1d2e7e6.
g1f3g8f6g2g3g7g6b2b3f8g7c1b2e8g8f1g2c7c5c2c4b8c6e1g1d7d6b1c3c8g4h2h3g4d7d2d4d8c8.
g1f3g8f6g2g3g7g6b2b4b7b6c1b2c8b7b1a3f8g7f1g2e8g8e1g1d7d6c2c4c7c5a3c2d8c7d2d3b8d7.
g1f3g8f6g2g3g7g6c2c4c7c6f1g2f8g7d2d4e8g8b1c3d7d5c4d5c6d5f3e5b7b6c1g5c8b7g5f6g7f6.
g1f3g8f6g2g3g7g6c2c4f8g7b1c3e8g8f1g2d7d6d2d4b8c6e1g1a7a6d4d5c6a5f3d2c7c5a1b1a8b8.
g1f3g8f6g2g3g7g6c2c4f8g7f1g2e8g8e1g1b8c6b1c3d7d6d2d4a7a6d4d5c6a5f3d2c7c5d1c2e7e5.
g1f3g8f6g2g3g7g6f1g2f8g7c2c4c7c6d2d4d7d5c4d5c6d5b1c3e8g8f3e5b8c6e1g1c8f5e5c6b7c6.
g1f3g8f6g2g3g7g6f1g2f8g7d2d4e8g8e1g1d7d6b2b3a7a5c2c4a5a4b3b4c7c5b4c5d6c5b1a3c5d4.
g1f3g8f6g2g3g7g6f1g2f8g7e1g1e8g8c2c4c7c6b2b3f6e4d2d4d7d5c1b2c8e6b1d2e4d2d1d2b8a6.
g1f3g8f6g2g3g7g6f1g2f8g7e1g1e8g8c2c4c7c6d2d4d7d5c4d5c6d5f3e5c8f5b1c3f6e4c1f4b8c6.
g1f3g8f6g2g3g7g6f1g2f8g7e1g1e8g8d2d3c7c5e2e4b8c6c2c3d7d5e4e5f6e8d3d4c8g4h2h3g4f3.
g1f3g8f6g2g3g7g6f1g2f8g7e1g1e8g8d2d3d7d5b1d2c7c5e2e4d5e4d3e4b8c6c2c3h7h6d1e2c8e6.
g1f3g8f6g2g3g7g6f1g2f8g7e1g1e8g8d2d4c7c5c2c3b7b6f3e5d7d5a2a4c8b7a4a5b8d7e5d7f6d7.
g2g3c7c5f1g2b8c6e2e4g7g6d2d3f8g7f2f4d7d6g1f3g8f6e1g1e8g8c2c3a8b8d1e2f6e8c1e3e8c7.
g2g3d7d5f1g2c7c6c2c4g8f6g1f3g7g6b2b3f8g7c1b2c8g4e1g1e8g8d2d3g4f3g2f3b8d7f3g2f8e8.
g2g3d7d5f1g2c7c6d2d3g8f6b1d2c8g4h2h3g4h5g1f3b8d7e1g1e7e6e2e4d5e4d3e4f8c5d1e2e8g8.
g2g3d7d5f2f4h7h5f1g2h5h4b1c3c7c6d2d3h4g3h2g3h8h1g2h1d8b6g1f3c8g4c3a4b6a5c2c3b8d7.
g2g3d7d5g1f3c7c5f1g2g7g6c2c4d5d4b2b4c5b4d1a4c8d7a4b4b8c6b4b3f8g7d2d3g8f6e1g1e8g8.
g2g3d7d5g1f3c7c5f1g2g7g6e1g1f8g7d2d4c5d4f3d4g8f6c2c4e8g8c4d5f6d5b1c3d5c3b2c3b8c6.
g2g3d7d5g1f3c7c6f1g2c8f5e1g1e7e6d2d3g8f6b1d2b8d7d1e1h7h6e2e4f5h7e1e2f8e7e4e5f6g8.
g2g3d7d5g1f3c7c6f1g2c8f5e1g1g8f6d2d3h7h6c2c4d5c4d3c4d8d1f1d1b8d7c1f4g7g5f4e3f8g7.
g2g3d7d5g1f3g8f6f1g2c7c6e1g1c8g4b2b3b8d7c1b2e7e6c2c4f8d6d2d4d8b8b1d2e8g8f1e1b7b5.
g2g3d7d5g1f3g8f6f1g2c8f5c2c4c7c6c4d5c6d5d1b3d8b6b3b6a7b6b1c3b8c6d2d3e7e6e1g1f8c5.
g2g3e7e5c2c4b8c6f1g2g7g6b1c3f8g7d2d3g8e7a1b1a7a5e2e3e8g8g1e2d7d6e1g1c8e6c3d5e7f5.
g2g3e7e5c2c4c7c6g1f3e5e4f3d4d7d5d2d3g8f6f1g2f8c5d4b3c5b4c1d2b4d2d1d2d5c4d3c4d8e7.
g2g3e7e5e2e4g8f6f1g2b8c6b1c3f8c5d2d3d7d6c3a4c5b4c2c3b4a5b2b4a5b6g1f3c8e6e1g1d8d7.
g2g3g7g6f1g2f8g7c2c4e7e5b1c3f7f5d2d4e5d4c3b5b8c6g1f3g8f6e1g1f6e4b5d4c6d4f3d4e8g8.
g2g3g7g6f1g2f8g7d2d4c7c5c2c3d8b6g1f3g8f6e1g1e8g8d4d5d7d6c3c4e7e6b1c3e6d5c4d5b8d7.
g2g3g7g6f1g2f8g7d2d4d7d6e2e4g8f6g1e2e8g8e1g1b8d7b1c3c7c6a2a4a7a5b2b3f8e8c1a3d8c7.
g2g3g7g6f1g2f8g7d2d4d7d6e2e4g8f6g1e2e8g8e1g1e7e5d4e5d6e5b2b3b8c6c1b2f8e8d1d8e8d8.
g2g3g7g6f1g2f8g7e2e4e7e5g1e2b8c6c2c3g8e7d2d4e5d4c3d4d7d5e4e5f7f6f2f4e8g8e1g1c8g4.
g2g3g7g6g1f3g8f6f1g2f8g7d2d4c7c5d4d5d7d6c2c4b7b5c4b5d8a5f3d2a5b5e1g1e8g8b1a3b5a6.
g2g3g8f6f1g2d7d5g1f3g7g6c2c4f8g7c4d5f6d5e1g1e8g8d2d4b8a6b1c3d5b6b2b3a6b4c1b2a7a5.
g2g3g8f6f1g2g7g6e2e4d7d6d2d4f8g7g1e2e8g8e1g1e7e5b1c3c7c6a2a4b8d7a4a5e5d4e2d4d7c5.
g2g3g8f6g1f3b7b5f1g2c8b7e1g1e7e6b2b3f8e7c2c4b5c4b3c4c7c5b1c3e8g8a1b1b7c6d2d3d7d6.
`.split('.').map(e => e.trim()).filter(e => e !== '')

// build book structure
var book = {} // book tree
var book_ptr = book // current position in book
if (OPENING_BOOK) {
  for (var s of book_entries) { // build opening book tree
    var moves = [] // convert each string in book_entries to array of moves
    while (s !== '') {
      moves.push(s.substring(0, 4))
      s = s.substring(4)
    }
    var ptr = book
    for (var m of moves) { // add each move, accumulating game counts and sub-books along the way
      if (m in ptr)
        ptr[m].games += 1
      else
        ptr[m] = { games: 1, book: {} }
      ptr = ptr[m].book
    }
  }
}
var in_book = Object.keys(book_ptr).length !== 0 // true if current position is still in opening book
var book_stack = [] // stores book ptr from previous plies
console.log(book)

console.log('- engine functions')
function print() {
  var PIECES = {
    0x00: 'EE',
    0x81: 'WP', 0x41: 'WN', 0x21: 'WB', 0x11: 'WR', 0x09: 'WQ', 0x05: 'WK',
    0x82: 'BP', 0x42: 'BN', 0x22: 'BB', 0x12: 'BR', 0x0A: 'BQ', 0x06: 'BK'
  }
  for (var r = 7; r >= 0; --r) {
    var line = ''
    for (var f = 0; f < 8; ++f) {
      var k = mailbox[(r << 4)|f]
      if (k in PIECES)
        line += PIECES[k]
      else
        line += k.toString(16).toUpperCase()
    }
    console.log(line)
  }
  console.log('castling:',castling,'ep:',ep,'->',SQUARES[ep],'moves:',moves,'score:',score,'fifty:',fifty,'hash:',hash)
}

function reset_board() {
  for (var i = 0; i < 128; ++i)
    mailbox[i] = initial_mailbox[i]|0
  turn = 0|0
  moves = 0|0
  castling = 0xF|0
  ep = -1|0
  score = 0|0
  kings = new Uint32Array([SQ_IDS['e1'], SQ_IDS['e8']])
  book_ptr = book
  in_book = Object.keys(book_ptr).length !== 0
}

function slow_evaluate() {
  var result = 0|0
  var i = 64|0; do {
    i = (i - 1)|0
    var sq = map0x88[i]
    var p = mailbox[sq] << 7|0
    result = (result + (eval_table[p + sq]|0))|0
  } while (i !== (0|0))
  return (turn|0) ? -result|0 : result|0
}

function evaluate() {
  return (turn|0) ? -score|0 : score|0
}

function is_attacked(sq, side) {
  sq = sq|0
  side = side|0
  var offset = (side|0) ? 6|0 : 0|0
  var i = 6|0; do {
    i = (i - 1)|0
    var p = PIECES[offset + i]|0
    if (((p & SLIDER_MASK)|0) !== (0|0)) {
      for (var j = (p << 4)|0; (deltas[j]|0) !== (0|0); j = (j + 1)|0) {
        var d = deltas[j]|0
        for (var to = (sq + d)|0; (((to & 0x88)|0) === (0|0)); to = (to + d)|0)
          if ((mailbox[to]|0) !== (0|0)) {
            if ((mailbox[to]|0) === (p|0)) {
              return 1|0
            }
            break
          }
      }
    } else {
      for (var j = (p << 4)|0; (deltas[j]|0) !== (0|0); j = (j + 1)|0) {
        var to = (sq - (deltas[j]|0))|0 // pawn captures are 'reversed'
        if (((to & 0x88)|0) !== (0|0)) continue // off mailbox
        if ((mailbox[to]|0) === (p|0)) return 1|0
      }
    }
  } while (i !== (0|0))
  return 0|0
}

function pick_book_move() {
  var options = {} // maps game count to move
  for (var m in book_ptr)
    options[book_ptr[m].games] = m
  var sorted_counts = Object.keys(options).map(e => e|0).sort() // sort in ascending order
  var total_count = sorted_counts.reduce((x, y) => x + y)
  var distr = sorted_counts.map(e => e / total_count) // get marginal probabilities
  for (var i = distr.length - 1; i > 0; --i) // in descending order,
    distr[i - 1] += distr[i] // turn marginal probabilities into cumulative probabilities
  distr.shift() // ditch first result (always 1)
  distr.push(0) // add 0 to end
  var toss = Math.random()
  for (var i = 0; i < distr.length; ++i) // find the first match in distr
    if (toss > distr[i]) // for which toss > cumulative probability
      return options[sorted_counts[i]] // and return the corresponding move
}

function get_book_move(m) {
  movegen()
  var offset = (moves << MAX_MOVE_SHIFT)|0
  for (var i = 0|0; (i|0) < (move_list_max[moves]|0); i = (i + 1)|0) // for all moves
    if (move_to_str(move_list[offset + i]) === m) // if found book move m
      return move_list[offset + i]|0 // return the corresponding int move
}

function book_histogram(n) {
  var choices = {}
  for (var i = 0; i < n; ++i) {
    var choice = pick_book_move()
    if (choice in choices)
      choices[choice] += 1
    else
      choices[choice] = 1
  }
  for (var choice in choices) {
    var s = ''
    for (var i = 0; i < choices[choice]; ++i)
      s += '.'
    console.log(choice + ' ' + s)
  }
}

function book_make(move) {
  if (in_book) {
    book_stack.push(book_ptr) // push old ptr
    var m = move_to_str(move)
    if (m in book_ptr) { // if move in book
      book_ptr = book_ptr[m].book // update book ptr
      in_book = Object.keys(book_ptr).length !== 0 // update in_book
    } else {
      in_book = false
    }
  }
}

function book_unmake(move) {
  if (moves < book_stack.length) { // if back in book line
    book_ptr = book_stack.pop() // restore book_ptr
    in_book = true // restore in_book
  }
}

function make(move) {
  move = move|0
  fiftys[moves] = fifty|0
  castlings[moves] = castling|0
  eps[moves] = ep|0
  scores[moves] = score|0
  hashs[moves << 1] = hash[0]|0
  hashs[moves << 1 | 1] = hash[1]|0
  hash[0] = (hash[0] ^ ZOBRIST_TURN[0])|0
  hash[1] = (hash[1] ^ ZOBRIST_TURN[1])|0

  book_make(move) // update book ptr and in_book

  var ptr = moves << 2 // ptr to make_pieces & make_squares
  
  // decompose bitfields
  var fr = (move & FROM_MASK)|0
  var to = ((move & TO_MASK) >> 8)|0
  var c = mailbox[to]|0
  var p = mailbox[fr]|0

  // update fifty
  fifty = (c !== EE || (p >> 2) === PAWN) ? 0|0 : (fifty + 1)|0
  
  // move piece
  make_pieces[ptr] = mailbox[fr] // vacate from sq
  make_squares[ptr] = fr
  ptr = (ptr + 1)|0 
  mailbox[fr] = 0|0
  score = (score - eval_table[c << 7 | to])|0 // subtract captured score (non ep)
  score = (score - eval_table[p << 7 | fr])|0 // subtract fr sq score
  hash[0] = (hash[0] ^ ZOBRIST_KEYS[          c << 7 | to])|0
  hash[1] = (hash[1] ^ ZOBRIST_KEYS[1 << 15 | c << 7 | to])|0
  hash[0] = (hash[0] ^ ZOBRIST_KEYS[          p << 7 | fr])|0
  hash[1] = (hash[1] ^ ZOBRIST_KEYS[1 << 15 | p << 7 | fr])|0

  // if KING move, update KING locations
  if ((p >> 2) === KING) 
    kings[turn] = to|0
  // update castling rights
  hash[0] = (hash[0] ^ ZOBRIST_CASTLING[         castling])|0
  hash[1] = (hash[1] ^ ZOBRIST_CASTLING[1 << 4 | castling])|0
  castling &= CASTLE_MASKS[to << 7 | fr]|0
  hash[0] = (hash[0] ^ ZOBRIST_CASTLING[         castling])|0
  hash[1] = (hash[1] ^ ZOBRIST_CASTLING[1 << 4 | castling])|0
  // update ep
  hash[0] = (hash[0] ^ ZOBRIST_EP[         ep])|0
  hash[1] = (hash[1] ^ ZOBRIST_EP[1 << 7 | ep])|0
  var sign = turn ? 1|0 : -1|0 
  ep = (p >> 2 === PAWN && (to ^ fr) === 32) ? (to + (sign << 4))|0 : -1|0
  hash[0] = (hash[0] ^ ZOBRIST_EP[         ep])|0
  hash[1] = (hash[1] ^ ZOBRIST_EP[1 << 7 | ep])|0

  // handle promotions
  var prom = (move & PROMOTION_MASK)|0
  if (prom !== (0|0)) { // if promotion
    prom >>= 24
    make_pieces[ptr] = mailbox[to]|0 // place promotion piece
    make_squares[ptr] = to|0
    ptr = (ptr + 1)|0
    mailbox[to] = prom
    score = (score + eval_table[prom << 7 | to])|0 // add promotion piece score  
    hash[0] = (hash[0] ^ ZOBRIST_KEYS[          prom << 7 | to])|0  
    hash[1] = (hash[1] ^ ZOBRIST_KEYS[1 << 15 | prom << 7 | to])|0  
  } else { // if not promotion
    make_pieces[ptr] = mailbox[to]|0 // place piece on to sq
    make_squares[ptr] = to|0
    ptr = (ptr + 1)|0
    mailbox[to] = p|0
    score = (score + eval_table[p << 7 | to])|0 // add to sq score 
    hash[0] = (hash[0] ^ ZOBRIST_KEYS[          p << 7 | to])|0  
    hash[1] = (hash[1] ^ ZOBRIST_KEYS[1 << 15 | p << 7 | to])|0  
  }
  // handle castling
  if (((move & CASTLE_MASK)|0) !== (0|0)) { 
    var rank = (turn|0) ? (7<<4)|0 : 0|0
    var rfr, rto
    if (((move & OO_MASK)|0) !== (0|0)) {
      rfr = (7 + rank)|0, rto = (5 + rank)|0
    } else {
      rfr = (0 + rank)|0, rto = (3 + rank)|0
    }
    var rook = mailbox[rfr]|0
    score = (score - eval_table[rook << 7 | rfr])|0 // subtract rook fr score
    score = (score + eval_table[rook << 7 | rto])|0 // add rook to score
    make_pieces[ptr] = mailbox[rto]|0 // add rook to rto
    make_squares[ptr] = rto|0
    ptr = (ptr + 1)|0 
    mailbox[rto] = rook|0
    hash[0] = (hash[0] ^ ZOBRIST_KEYS[          rook << 7 | rto])|0  
    hash[1] = (hash[1] ^ ZOBRIST_KEYS[1 << 15 | rook << 7 | rto])|0  
    make_pieces[ptr] = mailbox[rfr]|0 // vacate rfr
    make_squares[ptr] = rfr|0
    ptr = (ptr + 1)|0 
    mailbox[rfr] = 0|0
    hash[0] = (hash[0] ^ ZOBRIST_KEYS[          rook << 7 | rfr])|0  
    hash[1] = (hash[1] ^ ZOBRIST_KEYS[1 << 15 | rook << 7 | rfr])|0  
  }
  // handle ep
  else if (((move & EP_MASK)|0) !== (0|0)) {
    var ep_square = (to + (sign<<4))|0
    make_pieces[ptr] = mailbox[ep_square]|0 // capture ep pawn
    make_squares[ptr] = ep_square|0
    ptr = (ptr + 1)|0 // final add
    make_squares[ptr] = 9|0 // set last value to junk value
    mailbox[ep_square] = 0
    score = (score - eval_table[(p^3) << 7 | ep_square])|0 // subtract enemy pawn score
    hash[0] = (hash[0] ^ ZOBRIST_KEYS[          (p^3) << 7 | ep_square])|0  
    hash[1] = (hash[1] ^ ZOBRIST_KEYS[1 << 15 | (p^3) << 7 | ep_square])|0  
  } else {
    // not castling or ep: set rest to junk values
    make_squares[ptr] = 9|0
    ptr = (ptr + 1)|0 
    make_squares[ptr] = 9|0
  }
  turn ^= 1|0
  moves = (moves + 1)|0
}

function unmake(move) {
  move = move|0

  turn ^= 1|0
  moves = (moves - 1)|0
  fifty = fiftys[moves]|0
  castling = castlings[moves]|0
  ep = eps[moves]|0
  score = scores[moves]|0
  hash[0] = hashs[moves << 1]|0
  hash[1] = hashs[moves << 1 | 1]|0
  
  // decompose bitfields
  var fr = (move & FROM_MASK)|0
  var to = ((move & TO_MASK) >> 8)|0
  var p = mailbox[to]|0
  
  // update KING location
  if (((p >> 2)|0) === KING)
    kings[turn] = fr|0 // update king location (if king move)
  
  // modify other SQUARES using make_pieces and make_squares
  var ptr = moves << 2
  mailbox[make_squares[ptr]] = make_pieces[ptr]
  ptr = (ptr + 1)|0
  mailbox[make_squares[ptr]] = make_pieces[ptr]
  ptr = (ptr + 1)|0
  mailbox[make_squares[ptr]] = make_pieces[ptr]
  ptr = (ptr + 1)|0
  mailbox[make_squares[ptr]] = make_pieces[ptr]
  ptr = (ptr + 1)|0

  // update book ptr
  book_unmake(move)
}

// Used in movegen()
var sqcheck = new Uint32Array([ // 1st in each list of 4 = k's dest sq.
// Lists (null-terminated) give SQUARES to check for attackers/occupiers before castling.
  SQ_IDS['g1'], SQ_IDS['f1'], 0, 0,
  SQ_IDS['c1'], SQ_IDS['b1'], SQ_IDS['d1'], 0,
  SQ_IDS['g8'], SQ_IDS['f8'], 0, 0,
  SQ_IDS['c8'], SQ_IDS['b8'], SQ_IDS['d8'], 0
])
var check_king = new Uint32Array([ // 1 if nEEd check if attacked, 0 if only check occupancy
  1, 1, 0, 0,
  1, 0, 1, 0,
  1, 1, 0, 0,
  1, 0, 1, 0
])
var castleBits = new Uint32Array([OO_MASK, OOO_MASK, OO_MASK, OOO_MASK]) // one for each entry in sqcheck
function movegen() {
  var new_max = 0|0
  var offset = (moves << MAX_MOVE_SHIFT)|0
  var turn_bit = (1 << turn)|0
  var i = 64|0; do { // for each square
    i = (i - 1)|0
    var sq = (i + (i & ~7))|0
    if (((mailbox[sq] & turn_bit)|0) !== (0|0)) { // if current piece can move
      var p = mailbox[sq]|0
      if (((p >> 2)|0) !== (PAWN|0)) { // if not pawn
        if (((p & SLIDER_MASK)|0) !== (0|0)) { // if sliding
          var j = (p << 4)|0; while ((deltas[j]|0) !== (0|0)) { // for all deltas
            var d = deltas[j]|0
            for (var to = (sq + d)|0; (((to & 0x88)|0) === (0|0)); to = (to + d)|0) { // while tosq is on mailbox, generate sliding attacks
              var c = mailbox[to]|0
              if (c !== (0|0)) { // if obstructed
                if (((c & turn_bit)|0) === (0|0)) { // if obstructed piece is enemy
                  move_list[offset+new_max] = (sq | (to << 8) | (c << 16))|0 // add capture
                  new_max = (new_max + 1)|0
                }
                break // stop generating sliding attacks
              } else { // if not obstructed
                move_list[offset+new_max] = (sq | (to << 8))|0 // add sliding attack and continue
                new_max = (new_max + 1)|0
              }
            }
            j = (j + 1)|0 // next delta
          }
        } else { // not sliding
          var j = (p << 4)|0; while ((deltas[j]|0) !== (0|0)) { // for all deltas
            var to = (sq + (deltas[j]|0))|0
            var c = mailbox[to]|0
            j = (j + 1)|0 // must be done before continue statement
            if ((((to & 0x88)|0) !== (0|0)) || (((c & turn_bit)|0) !== (0|0)))
              continue // if off mailbox or friendly obstruction, skip this delta
            move_list[offset+new_max] = (sq | (to << 8) | (c << 16))|0 // add move
            new_max = (new_max + 1)|0
          }
          if (((p >> 2)|0) === KING) { // if king, generate castlings
            var enemy = (turn ^ 1)|0
            var j = 4|0; do { // for each possible castling
              j = (j - 1)|0
              if ((castling & (1 << j)) !== (0|0)) {
                var ok = 1|0
                var k = (j << 2)|0; while ((sqcheck[k]|0) !== (0|0)) {
                  var chk = sqcheck[k]|0
                  if ((mailbox[chk]|0) !== (0|0) || ((check_king[k]|0 !== (0|0)) && (is_attacked(chk, enemy) !== (0|0)))) {
                    ok = 0|0
                    break
                  }
                  k = (k + 1)|0
                }
                if ((ok|0) !== (0|0)) {
                  move_list[offset+new_max] = (sq | ((sqcheck[j << 2]|0) << 8) | (castleBits[j]|0))|0
                  new_max = (new_max + 1)|0
                }
              }
            } while ((j|0) !== (0|0))
          }
        }
      } else { // pawn moves
        var sign = (turn|0) ? -1|0 : 1|0
        var double_rank = (turn|0) ? 6|0 : 1|0
        var prom_rank = (turn|0) ? 0|0 : 7|0
        
        var first = (sq + (sign<<4))|0
        if ((mailbox[first]|0) === (0|0)) { // single step if empty
          if (((first >> 4)|0) === (prom_rank|0)) { // if rank 7 or 2, add promotions
            var template = (sq | (first << 8) | (turn_bit << 24))|0
            move_list[offset+new_max] = (template | (QUEEN << 26))|0
            move_list[offset+new_max+1] = (template | (ROOK << 26))|0
            move_list[offset+new_max+2] = (template | (BISHOP << 26))|0
            move_list[offset+new_max+3] = (template | (KNIGHT << 26))|0
            new_max = (new_max + 4)|0
          } else { // otherwise, add normal moves
            move_list[offset+new_max] = (sq | (first << 8))|0
            new_max = (new_max + 1)|0
          }
          var second = (sq + (sign<<5))|0
          if (((sq >> 4) === double_rank) && ((mailbox[second]|0) === (0|0))) { // double step if empty
            move_list[offset+new_max] = (sq | (second << 8))|0
            new_max = (new_max + 1)|0
          }
        }
        var j = (p << 4)|0; while ((deltas[j]|0) !== (0|0)) { // for all capture deltas
          var capt = (sq + (deltas[j]|0))|0
          if ((((capt & 0x88)|0) === (0|0)) && ((mailbox[capt]|0) !== (0|0))) {
            if ((((mailbox[capt]|0) & turn_bit)|0) === (0|0)) { // found enemy piece
              if (((capt >> 4)|0) === (prom_rank|0)) { // if rank 7 or 2, add as capture with promotion
                var template = (sq | (capt << 8) | ((mailbox[capt]|0) << 16) | (turn_bit << 24))|0
                move_list[offset+new_max] = (template | (QUEEN << 26))|0
                move_list[offset+new_max+1] = (template | (ROOK << 26))|0
                move_list[offset+new_max+2] = (template | (BISHOP << 26))|0
                move_list[offset+new_max+3] = (template | (KNIGHT << 26))|0
                new_max = (new_max + 4)|0
              } else { // otherwise, add normal capture
                move_list[offset+new_max] = (sq | (capt << 8) | ((mailbox[capt]|0) << 16))|0
                new_max = (new_max + 1)|0
              }
            }
          } else if ((capt|0) === (ep|0)) { // if capture sq is en passant square
            move_list[offset+new_max] = (sq | (capt << 8) | EP_MASK)|0 // add en passant
            new_max = (new_max + 1)|0
          }
          j = (j + 1)|0 // next capture delta
        }
      }
    }
  } while (i !== (0|0)) // while there are still squares left to consider
  move_list_max[moves] = new_max
}

function move_to_str(m) {
  return SQUARES[m & FROM_MASK] + SQUARES[(m & TO_MASK) >> 8] //+ ((m & PROMOTION_MASK) ? '=' + PIECE_NAMES[(m & PROMOTION_MASK) >> 26].toUpperCase() : '') TODO: returns undefined sometimes
  //  + ', ' + (m & 0xFF) + ' ' + ((m >> 8) & 0xFF)
  //  + ' ' + ((m >> 16) & 0xFF) + ' ' + ((m >> 24) & 0xFF)
}

function score_to_str(s) {
  var mate_in = MATE_SCORE - Math.abs(s)
  if (mate_in < 100)
    return '#' + ['', '-'][+(s < 0)] + mate_in
  else
    return (s/100).toString()
}

function legalize() {
  var offset = (moves << MAX_MOVE_SHIFT)|0, new_max = 0|0
  for (var i = 0|0; (i|0) < (move_list_max[moves]|0); i = (i + 1)|0) {
    var j = (offset + i)|0
    if (((((move_list[j]|0) & CASTLE_MASK)|0) !== (0|0))
      && ((is_attacked(kings[turn]|0, (turn ^ 1)|0)|0) !== (0|0))) {
      continue // can't castle out of check
    }
    make(move_list[j]|0)
    if ((is_attacked(kings[turn ^ 1]|0, turn|0)|0) === (0|0)) { // can't move into check
      move_list[offset+new_max] = move_list[j]|0
      new_max = (new_max + 1)|0
    }
    unmake(move_list[j]|0)
  }
  move_list_max[moves] = new_max|0
}

var hits = 0
var collisions = 0
var saved = 0
var probed = 0
function score_move(move/*, verbose*/) {
  if (TRANSPOSITION_TABLE) {
    var key = tt_key()
    if (hash[0] === tt[key] && hash[1] === tt[key + 1] && move === tt[key + 2]) { // for entries in tt, previously determined best move always takes priority
      if (DEBUG)
        ++hits
      return 0|0 // lowest score is best
    }
  }
  var fr = (move & FROM_MASK)|0 // extract fr, to, piece
  var to = (move & TO_MASK) >> 8
  var p = mailbox[fr] << 7
  var sign = (turn|0) === (0|0) ? 1 : -1
  var result = sign*(eval_table[p | fr] - eval_table[p | to]) >> 2 // score = -pst delta/4
  if (((move & CAPTURE_MASK)|0) !== (0|0)) { // if capture,
    result = (result + (sign*eval_table[mailbox[to] << 7 | to] >> 4))|0 // score -= |captured piece value|/16
    if ((p >> 9) === (KING|0)) // if king capture,
      result = (result + (1000 >> 6))|0 // score += 1000/64
    else
      result = (result + (sign*eval_table[p | fr] >> 6))|0 // score += |capturing piece value|/64
  }
  //score = (score - ((move & CAPTURE_MASK)|0 ? 50 : 0|0))|0 // score -= 50 if capture
  result = (result + 64)|0 // force a positive value 0..MAX_MOVE_SCORE
  //if (verbose)
  //  console.log(move_to_str(move), score, eval_table[p | fr] - eval_table[p | to])
  //if (result < 0 || result > 127) 
  //  console.log(move_to_str(move), ((move & CAPTURE_MASK) >> 16).toString(2), mailbox[fr].toString(2), result, p >>2, KING)
  return (result|0) < (0|0) ? 0|0 : result|0
}

var sort = function() { return 'placeholder' }

if (MOVE_ORDERING_ALGORITHM === 'RADIX') {

sort = function(/*verbose*/) {
  var length = move_list_max[moves]|0 // number of candidate moves
  var offset = (moves << MAX_MOVE_SHIFT)|0 // ptr in move_list
  
  // initialization
  for (var i = 0|0; (i|0) < (length|0); i = (i + 1)|0) // for each move,
    radix_swap_space[i] = move_list[offset + i]|0 // copy the candidate list
  for (var i = 0|0; (i|0) < (MAX_MOVE_SCORE|0); i = (i + 1)|0) // for scores 0..max-1,
    radix_counts[i] = 0|0 // initialize counts to zero
  //if (verbose) console.log('initialized counts:', radix_counts, 'swap space:', radix_swap_space)
  
  // key indexed counting
  for (var i = 0|0; (i|0) < (length|0); i = (i + 1)|0) { // score each move (lower is better)
    var score = score_move(radix_swap_space[i])|0
    radix_scores[i] = score|0 // record score
    radix_counts[score] = (radix_counts[score] + 1)|0 // update count
  }
  for (var i = 1|0; (i|0) < (MAX_MOVE_SCORE|0); i = (i + 1)|0) // for scores 1..max-1,
    radix_counts[i] = (radix_counts[i] + radix_counts[i - 1])|0 // convert the count to a maximum offset in sorted array
  //if (verbose) console.log('after key indexed counting:', JSON.stringify(radix_counts))
  
  // sort
  for (var i = 0|0; (i|0) < (length|0); i = (i + 1)|0) { // for each candidate move,
    var score = radix_scores[i] // extract score
    radix_counts[score] = (radix_counts[score] - 1)|0 // decrement offset in sorted array
    move_list[offset + radix_counts[score]] = radix_swap_space[i] // place sorted move
  }
  //if (verbose) console.log('sorted move list:', Array.from(move_list.slice(offset, offset + length)).map(e => move_to_str(e) + '=' + score_move(e)).join(' '))
}

} else if (MOVE_ORDERING_ALGORITHM === 'BUILTIN') {

sort = function(verbose = false) {
  var copied = []
  var offset = (moves << MAX_MOVE_SHIFT)|0
  for (var i = 0|0; (i|0) < (move_list_max[moves]|0); i = (i + 1)|0) {
    var score = score_move(move_list[offset+i])|0
    copied.push({ m: move_list[offset+i]|0, s: score|0 })
  }
  copied.sort(function(a, b) { return +(a.s - b.s) })
  for (var i = 0|0; (i|0) < (copied.length|0); i = (i + 1)|0)
    move_list[offset+i] = copied[i].m|0
  if (verbose) console.log('sorted move list:', Array.from(move_list.slice(offset, offset + length)).map(e => move_to_str(e) + '=' + score_move(e)).join(' '))
}

} else console.error('Unrecognized move ordering algorithm "' + MOVE_ORDERING_ALGORITHM + '"')

function san_list() {
  movegen()
  legalize()
  
  var result = {}
  var offset = (moves << MAX_MOVE_SHIFT)|0
  for (var i = 0; i < move_list_max[moves]; ++i) {
    var j = offset + i
    make(move_list[j])
    
    movegen()    
    legalize()
    
    var check = (is_attacked(kings[turn], turn ^ 1)) ? ((move_list_max[moves] === (0|0)) ? '#' : '+') : ''
    unmake(move_list[j])
    
    if (move_list[j] & CASTLE_MASK) {
      if (move_list[j] & OO_MASK)
        result['O-O' + check] = move_list[j]
      else
        result['O-O-O' + check] = move_list[j]
    } else {
      var fr = SQUARES[move_list[j] & FROM_MASK]
      var to = SQUARES[(move_list[j] & TO_MASK) >> 8]
      var isCapt = (move_list[j] & CAPTURE_MASK) || (move_list[j] & EP_MASK)
      var p = PIECE_NAMES[mailbox[move_list[j] & FROM_MASK] >> 2]
      var piece = (p !== 'p') ? p.toUpperCase() : (isCapt ? fr[0] : '')
      var capt = isCapt ? 'x' : ''
      var prom = (move_list[j] & PROMOTION_MASK) ?
        '='+PIECE_NAMES[(move_list[j] & PROMOTION_MASK) >> 26].toUpperCase() : ''
      var dis = ''
      for (var k = 0; k < move_list_max[moves]; ++k) {
        if ((p !== 'p') && (i !== k)) {
          var l = offset + k
          var otherP = PIECE_NAMES[mailbox[move_list[l] & FROM_MASK] >> 2]
          var other_to = SQUARES[(move_list[l] & TO_MASK) >> 8]
          if ((otherP === p) && (other_to === to)) {
            var other_fr = SQUARES[move_list[l] & FROM_MASK]
            for (var m = other_fr.length-1; m >= 0; --m) {
              if (fr[m] !== other_fr[m])
                dis = fr[m]
            }
            break
          }
        }
      }
      result[piece + dis + capt + to + prom + check] = move_list[j]
    }
  }
  return result
}

function apply(sans) {
  for (var i = 0; i < sans.length; ++i) {
    var legal = san_list()
    var san = sans[i].replace(new RegExp(String.fromCharCode(1093), 'g'), 'x')
    if (!(san in legal)) {
      console.log(san + ' is illegal: legal moves are ' + Object.keys(legal).join(', '))
    } else {
      make(legal[san]|0)
      if (DEBUG)
        console.log('Made move: ' + san + ' => ' + legal[san] + '. Current score: ' + evaluate())
    }
  }
}

function perft(depth) {
  if (depth === (0|0)) return 1
  var result = 0
  movegen(); legalize()
  if (MOVE_ORDERING)
    sort()
  var offset = (moves << MAX_MOVE_SHIFT)|0
  for (var i = 0; i < move_list_max[moves]; ++i) {
    make(move_list[offset+i]|0)
    result += perft(depth-1)
    evaluate()
    unmake(move_list[offset+i]|0)
  }
  return result
}

function divide(depth) {
  var list = san_list()
  var result = []
  for (var san in list) {
    make(list[san])
    result.push({ san: san, move: list[san], movestr: move_to_str(list[san]), count: perft(depth-1) })
    unmake(list[san])
  }
  return result
}

function tt_key() {
  return ((hash[0] & TRANSPOSITION_TABLE_MASK) * 5)|0
}

function add_tt_entry(score, move, depth) {
  if (TRANSPOSITION_TABLE) {
    var key = tt_key()
    if (DEBUG)
      if (tt[key + 2] !== 0 && (tt[key] !== hash[0] || tt[key + 1] !== hash[1]))
        ++collisions
    tt[key] = hash[0]|0
    tt[key + 1] = hash[1]|0
    tt[key + 2] = move|0
    tt[key + 3] = ((turn|0) === (0|0)) ? score|0 : -score|0
    tt[key + 4] = depth|0
  }
  return score
}

// lookup table used for late move reductions
var MAX_DEPTH_DECREMENT = ['placeholder']
if (LATE_MOVE_REDUCTIONS) {
  MAX_DEPTH_DECREMENT = new Uint32Array(1 << MAX_MOVE_SHIFT).fill(3).map((e, i) => (i < 8) ? [
    // for any candidate move list, consider:
    1, 1, 1, 1, 1, 1, 1, 1, // the first 8 normally
    2, 2, 2, 2, 2, 2, 2, 2, // the next 8 at max depth - 1
    // anything else at max depth - 2
  ][i] : e)
} else
  MAX_DEPTH_DECREMENT = new Uint32Array(1 << MAX_MOVE_SHIFT).fill(1)

function next_max_depth(max_depth, i) {
  return (max_depth < 3) ? max_depth : max_depth - MAX_DEPTH_DECREMENT[i]
}

function alphabeta(alpha, beta, depth, max_depth, end_time, nodes = [0]) {
  alpha = alpha|0, beta = beta|0, depth = depth|0
  if (Date.now() >= end_time)
    return TIME_UP_SCORE
  // check for threefold repetition
  var repetitions = 0
  for (var i = 1|0; (i|0) <= (fifty|0); i = (i + 1)|0) {
    if (hash[0] === hashs[(moves - i) << 1] && hash[1] === hashs[(moves - i) << 1 | 1])
      repetitions = (repetitions + 1)|0
  }
  if ((repetitions|0) >= (2|0)) // 2 previous repetitions of current position = 3-fold
    return 0|0
  // leaf node
  if ((depth|0) >= (max_depth|0)) {
    if (!CHECK_EXTENSIONS || !is_attacked(kings[turn], turn^1)) {
      nodes[0] = (nodes[0] + 1)|0
      return evaluate()|0 //quiesce(alpha, beta)
    }
  }
  if (TRANSPOSITION_TABLE) {
    var key = tt_key()
    if (hash[0] === tt[key] && hash[1] === tt[key + 1]) { // if entry in table exists
      ++probed
      if ((tt[key + 4]|0) >= ((max_depth - depth)|0)) { // if depth searched >= current depth left
        ++saved
        var score = ((turn|0) === (0|0)) ? tt[key + 3]|0 : -tt[key + 3]|0 // set window near saved score
        alpha = score - 150
        beta = score + 150
      }
    }
  }
  movegen(); legalize()
  if (MOVE_ORDERING)
    sort()
  if (move_list_max[moves] === (0|0)) // checkmate or stalemate
    return is_attacked(kings[turn], turn^1)|0 ? -(MATE_SCORE - depth)|0 : 0|0
  var best = 0|0
  var offset = (moves << MAX_MOVE_SHIFT)|0
  for (var i = 0|0; (i|0) < (move_list_max[moves]|0); i = (i + 1)|0) {
    var m = move_list[offset+i]|0
    make(m)
    var score = (CHECK_EXTENSIONS && is_attacked(kings[turn], turn^1)) ? 
      -alphabeta(-beta|0, -alpha|0,  depth     |0,                max_depth    , end_time, nodes)|0 :
      -alphabeta(-beta|0, -alpha|0, (depth + 1)|0, next_max_depth(max_depth, i), end_time, nodes)|0
    unmake(m)
    if ((score|0) >= (beta|0))
      return add_tt_entry(score, m, max_depth - depth)|0 // fail soft beta-cutoff
    if ((score|0) > (alpha|0)) {
      alpha = score|0 // alpha acts like max in minimax
      best = m|0
    }
  }
  return add_tt_entry(alpha, best, max_depth - depth)|0
}

function go_once(depth, end_time, nodes = [0]) {
  if (DEBUG)
    console.log('Searching depth', depth)
  if (in_book)
    return { score: 'book', best: move_to_str(get_book_move(pick_book_move())) }
  depth = depth|0
  if ((depth|0) === (0|0)) {
    nodes[0] = (nodes[0] + 1)|0
    return evaluate()|0 //quiesce(alpha, beta)
  }
  var alpha = -MATE_SCORE|0, beta = MATE_SCORE|0
  movegen(); legalize()
  if (MOVE_ORDERING)
    sort()
  //var m = []
  //var offset = (moves << MAX_MOVE_SHIFT)|0
  //for (var i = 0|0; (i|0) < (move_list_max[moves]|0); i = (i + 1)|0)
  //  m.push(move_to_str(move_list[offset + i]) + '=' + score_move(move_list[offset + i], true))
  //console.log('After sort: ' + m.join(' '))
  var offset = (moves << MAX_MOVE_SHIFT)|0
  var best = move_list[offset]
  for (var i = 0|0; (i|0) < (move_list_max[moves]|0); i = (i + 1)|0) {
    var m = move_list[offset+i]|0
    make(m)
    var score = -alphabeta(-beta|0, -alpha|0, 0|0, depth, end_time, nodes)|0
    unmake(m)
    if (score >= beta)
      return { score: add_tt_entry(score, m, depth), best: move_to_str(m) }
    if (score > alpha) {
      alpha = score|0
      best = m|0
    }
  }
  return { score: add_tt_entry(alpha, best, depth), best: move_to_str(best) }
}

function go(time = SEARCH_TIME, nodes = [0]) {
  var end_time = Date.now() + time
  var results = [go_once(1, Date.now() + 10000000000, nodes)]
  for (var depth = 2; true; ++depth) {
    var result = go_once(depth, end_time, nodes)
    if (result.score === 'book') {
      result.depth = 0
      return [result]
    }
    result.depth = depth
    results.push(result)
    if (Date.now() >= end_time) {
      results.pop()
      break
    }
  }
  return results
}
//fns

function perft_check(name, pos, toMove, castlingRights, epSquare, expected, maxdepth) {
  for (var i = 0; i < 128; ++i)
    mailbox[i] = pos[i]|0
  turn = toMove|0
  moves = 0|0
  castling = castlingRights|0
  ep = epSquare|0
  score = slow_evaluate()|0
  console.log('Perft (' + name + '):')
  for (var i = 1; i <= maxdepth; ++i) {
    var startTime = Date.now()
    var n = perft(i)
    var duration = (Date.now() - startTime)
    console.log('- perft(' + i + ') = ' + n + ' (expected ' + expected[i] + '). Duration: '
      + duration + ' ms (' + (Math.round(100*n/(duration))/100) + ' knps). Score: ' + score)
  }
}

// perft positions taken from https://chessprogramming.wikispaces.com/Perft+Results
perft_check('initial', initial_mailbox, 0, 0xF, -1, [1, 20, 400, 8902, 197281, 4865609, 119060324], 4)

if (PERFT) {
  perft_check('kiwipete', [
    WR, EE, EE, EE, WK, EE, EE, WR, 0,0,0,0,0,0,0,0,
    WP, WP, WP, WB, WB, WP, WP, WP, 0,0,0,0,0,0,0,0,
    EE, EE, WN, EE, EE, WQ, EE, BP, 0,0,0,0,0,0,0,0,
    EE, BP, EE, EE, WP, EE, EE, EE, 0,0,0,0,0,0,0,0,
    EE, EE, EE, WP, WN, EE, EE, EE, 0,0,0,0,0,0,0,0,
    BB, BN, EE, EE, BP, BN, BP, EE, 0,0,0,0,0,0,0,0,
    BP, EE, BP, BP, BQ, BP, BB, EE, 0,0,0,0,0,0,0,0,
    BR, EE, EE, EE, BK, EE, EE, BR, 0,0,0,0,0,0,0,0
  ], 0, 0xF, -1, [1, 48, 2039, 97862, 4085603, 193690690], 4)
  
  perft_check('rook endgame', [
    EE, EE, EE, EE, EE, EE, EE, EE, 0,0,0,0,0,0,0,0,
    EE, EE, EE, EE, WP, EE, WP, EE, 0,0,0,0,0,0,0,0,
    EE, EE, EE, EE, EE, EE, EE, EE, 0,0,0,0,0,0,0,0,
    EE, WR, EE, EE, EE, BP, EE, BK, 0,0,0,0,0,0,0,0,
    WK, WP, EE, EE, EE, EE, EE, BR, 0,0,0,0,0,0,0,0,
    EE, EE, EE, BP, EE, EE, EE, EE, 0,0,0,0,0,0,0,0,
    EE, EE, BP, EE, EE, EE, EE, EE, 0,0,0,0,0,0,0,0,
    EE, EE, EE, EE, EE, EE, EE, EE, 0,0,0,0,0,0,0,0
  ], 0, 0x0, -1, [1, 14, 191, 2812, 43238, 674624, 11030083], 6)
  
  perft_check('complicated', [
    WR, EE, EE, WQ, EE, WR, WK, EE, 0,0,0,0,0,0,0,0,
    WP, BP, EE, WP, EE, EE, WP, WP, 0,0,0,0,0,0,0,0,
    BQ, EE, EE, EE, EE, WN, EE, EE, 0,0,0,0,0,0,0,0,
    WB, WB, WP, EE, WP, EE, EE, EE, 0,0,0,0,0,0,0,0,
    BN, WP, EE, EE, EE, EE, EE, EE, 0,0,0,0,0,0,0,0,
    EE, BB, EE, EE, EE, BN, BB, WN, 0,0,0,0,0,0,0,0,
    WP, BP, BP, BP, EE, BP, BP, BP, 0,0,0,0,0,0,0,0,
    BR, EE, EE, EE, BK, EE, EE, BR, 0,0,0,0,0,0,0,0
  ], 0, 0xC, -1, [1, 2, 264, 9467, 422333, 15833292], 5)
  
  perft_check('tricky', [
    WR, WN, WB, WQ, WK, EE, EE, WR, 0,0,0,0,0,0,0,0,
    WP, WP, WP, EE, WN, BN, WP, WP, 0,0,0,0,0,0,0,0,
    EE, EE, EE, EE, EE, EE, EE, EE, 0,0,0,0,0,0,0,0,
    EE, EE, WB, EE, EE, EE, EE, EE, 0,0,0,0,0,0,0,0,
    EE, EE, EE, EE, EE, EE, EE, EE, 0,0,0,0,0,0,0,0,
    EE, EE, BP, EE, EE, EE, EE, EE, 0,0,0,0,0,0,0,0,
    BP, BP, EE, WP, BB, BP, BP, BP, 0,0,0,0,0,0,0,0,
    BR, BN, BB, BQ, EE, BK, EE, BR, 0,0,0,0,0,0,0,0
  ], 0, 0x3, -1, [1, 44, 1486, 62379, 2103487], 4)
  
  perft_check('symmetric', [
    WR, EE, EE, EE, EE, WR, WK, EE, 0,0,0,0,0,0,0,0,
    EE, WP, WP, EE, WQ, WP, WP, WP, 0,0,0,0,0,0,0,0,
    WP, EE, WN, WP, EE, WN, EE, EE, 0,0,0,0,0,0,0,0,
    EE, EE, WB, EE, WP, EE, BB, EE, 0,0,0,0,0,0,0,0,
    EE, EE, BB, EE, BP, EE, WB, EE, 0,0,0,0,0,0,0,0,
    BP, EE, BN, BP, EE, BN, EE, EE, 0,0,0,0,0,0,0,0,
    EE, BP, BP, EE, BQ, BP, BP, BP, 0,0,0,0,0,0,0,0,
    BR, EE, EE, EE, EE, BR, BK, EE, 0,0,0,0,0,0,0,0
  ], 0, 0x0, -1, [1, 46, 2079, 89890, 3894594], 4)
}

console.log('Done. Total time:', (Date.now()-start)/1000 + 's')
//engine

function get_moves() {
  var raw = document.getElementsByClassName('moves')[0].children // document.getElementsByClassName('areplay')[0].children[1]; 
  var accu = []
  for (var i = 0; i < raw.length; ++i) {
    if (raw[i].tagName === 'MOVE' && raw[i].className !== 'empty') {
      var text = raw[i].innerText.trim()
      if (text)
        accu.push(text)
    }
  }
  return accu
}

function init_display() {
  for (var i = 0; i < 64; ++i) {
    overlay.appendChild(document.createElement('div'))
    overlay.children[i].style.float = 'left'
    overlay.children[i].style.left = ((100*(i%8)/8).toString()) + '%'
    overlay.children[i].style.top = ((100*(i>>3)/8).toString()) + '%'
    overlay.children[i].style.width = (100/8).toString() + '%'
    overlay.children[i].style.height = (100/8).toString() + '%'
  }
  new_game()
}

function resize_display() {
  var boardDOM = document.getElementsByClassName('lichess_game')[0].children[0]
  var rect = boardDOM.getBoundingClientRect()
  overlay.style.opacity = 1
  overlay.style.zIndex = 1
  overlay.style.position = 'fixed'
  overlay.style.left = rect.left + 'px'
  overlay.style.top = rect.top + 'px'
  overlay.style.width = rect.width + 'px'
  overlay.style.height = rect.width + 'px'
}

function update_display(heatmap) {
  resize_display()
  var scheme = { // matlab imagesc scheme
    '-6': 'transparent',
    '-5': 'rgb(53, 42, 134)',
    '-4': 'rgb(31, 82, 211)',
    '-3': 'rgb(12, 116, 220)',
    '-2': 'rgb(12, 147, 209)',
    '-1': 'rgb(6, 169, 192)',
     '0': 'rgb(55, 184, 157)',
     '1': 'rgb(124, 191, 123)',
     '2': 'rgb(183, 188, 99)',
     '3': 'rgb(240, 185, 73)',
     '4': 'rgb(249, 210, 41)',
     '5': 'rgb(248, 250, 13)'
  }
  for (var i = 0; i < 64; ++i) {
    overlay.children[i].style.backgroundColor = scheme[heatmap[i]]
    //overlay.children[i].innerText = heatmap[i]
  }
}

function clock() {
  var [mm, ss_frac] = document.getElementsByClassName('lichess_game')[0].children[1].children[1].children[2].children[1].innerText.split(':')
  return 60*parseInt(mm) + parseFloat(ss_frac)
}

function new_game() {
  flip = +document.getElementsByClassName('lichess_game')[0].children[0].children[0].children[0].className.includes("black")
  //flip = parseInt(prompt('New game! Side (0 = white, 1 = black)?', 0))
  total_time = clock()
  move_change()
}

function display_move(move_string) {
  var fr = SQ_IDS[move_string.substring(0, 2)]
  var to = SQ_IDS[move_string.substring(2, 4)]
  fr = (fr + (fr & 7)) >> 1
  to = (to + (to & 7)) >> 1
  heatmap[fr] = heatmap[to] = -5
  
  var translated = Array(64)
  for (var i = 0; i < 8; ++i) {
    for (var j = 0; j < 8; ++j) {
      translated[i*8 + j] = flip ? heatmap[8*i + (7-j)] : heatmap[8*(7-i) + j]
    }
  }
  update_display(translated)
}

function search_record_to_string(record) {
  return (record.score === 'book' ? 'book' : score_to_str(record.score)) + ' ' + record.best +
    ' (depth ' + record.depth + ', ' + record.nodes + ' nodes in ' + record.ms +
    ' ms at ' + (Math.round(100*record.nodes/record.ms)/100) + ' knps)'
}

function make_lichess(move) {
  var keyboard_input = document.getElementsByClassName('keyboard-move')[0].children[0]
  keyboard_input.value = move.substring(0, 2)
  keyboard_input.dispatchEvent(new KeyboardEvent('keyup'))
  keyboard_input.value = move.substring(2, 4)
  keyboard_input.dispatchEvent(new KeyboardEvent('keyup'))
}

// used for time management. modified version of graph on this page: https://chessprogramming.wikispaces.com/Time+Management
var TIME_TABLE = [
  1, 1, 2, 2, 2, 2, 3, 3, 3, // opening
  3, 3, 3, 3, 3, 4, 4, 5, 5, 7, 9, 9, 9, 9, 7, 5, 5, 5, 4, 4, 3, 4, 4, // middlegame
  3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 // endgame
].map(e => [e, e]).reduce((x, y) => x.concat(y)) // convert turns to plies
TIME_TABLE = TIME_TABLE.map(e => e / TIME_TABLE.reduce((x, y) => x + y)) // convert times to proportions

function time_allocation(i) {
  var j = Math.min(i, TIME_TABLE.length - 1)
  var result = Math.max(Math.floor(total_time * TIME_TABLE[j] * 1.4 * 1000), 400)
  if (DEBUG)
    console.log('Allocating', result, 'ms for move', i)
  return result
}

function move_change(search_time = SEARCH_TIME) {
  if (COMMENTARY || move_record.length % 2 === flip) {
    var start = Date.now()
    reset_board()
    apply(move_record)
    var heatmap = Array(64)
    for (var i = 0; i < 64; ++i) heatmap[i] = -6
    if (DEBUG)
      console.log('No. of legal moves:', Object.keys(san_list()).length)
    var nodes = [0]
    var wrap = function(obj) { obj.depth = 0 }
    var panicking = PANIC && (clock() < 10)
    var search_results = panicking ? [wrap(go_once(3, Date.now() + 10000000, nodes))] : go(time_allocation(moves), nodes)
    var search_result = search_results.slice(-1)[0]
    var i = search_results.length - 1
    while (i--)
      if (search_results[i].best !== search_result.best)
        break
    if (DEBUG) {
      console.log(search_results.map((e, i) => e.score + ' ' + e.best + ' (' + i + ')\n').join(''))
      console.log('key depth = ' + (i + 1).toString())
    }
    display_move(search_result.best)
    if (AUTOPILOT) {
      var delay = (search_result.score === 'book') ? time_allocation(moves) : panicking ? 100 : 0
      setTimeout(function() { make_lichess(search_result.best) }, delay)
    }
    console.log('Time remaining:', clock())
    print()
    var duration = Date.now() - start
    var record = {
      score: search_result.score,
      best: search_result.best,
      depth: search_result.depth,
      ms: duration,
      nodes: nodes[0]
    }
    search_history.push(record)
    if (DEBUG)
      console.log(search_record_to_string(record))
  }
}

function print_search_history() {
  var total_depth = 0
  var total_nodes = 0
  var total_duration = 0
  var total_knps = 0
  for (const record of search_history) {
    total_depth += record.depth
    total_nodes += record.nodes
    total_duration += record.ms
    total_knps += Math.round(100*record.nodes/record.ms)/100
  }
  console.log(
    search_history.map(e => search_record_to_string(e)).join('\n') + '\n' +
    'On average: depth ' + Math.round(total_depth / search_history.length) + ', ' +
    Math.round(total_nodes / search_history.length) + ' nodes, ' +
    Math.round(total_duration / search_history.length) + ' ms, ' +
    Math.round(total_knps / search_history.length) + ' knps'
  )
}

if (INTERFACE) {

var move_record = []
var search_history = []
var total_time = 0
var last_new_game = Date.now()
var flip = 0
if (typeof overlay === 'undefined') {
  var overlay = document.createElement('div')
  overlay.onmousedown = function() { overlay.style.zIndex = -1; }
  overlay.onmouseup = function() { overlay.style.zIndex = 1; }
  init_display()
  resize_display()
  document.body.appendChild(overlay)
}

if (typeof tick_interval !== 'undefined')
  clearInterval(tick_interval)
tick_interval = setInterval(function(){
  var m = get_moves()
  if (m.join(' ') !== move_record.join(' ')) {
    //if (m.length === (0|0)) new_game()
    move_record = m
    move_change()
  }
}, 100)

} // if (INTERFACE)