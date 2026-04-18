(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd) // AMD
    define(["../../lib/codemirror"], mod);
  else // Plain browser env
    mod(CodeMirror);
})(function(CodeMirror) {
"use strict";

CodeMirror.defineMode("pawn", function(config, parserConfig) {
  var indentUnit = config.indentUnit,
      statementIndentUnit = parserConfig.statementIndentUnit || indentUnit,
      dontAlignCalls = parserConfig.dontAlignCalls,
      keywords = parserConfig.keywords || {},
      builtin = parserConfig.builtin || {},
      blockKeywords = parserConfig.blockKeywords || {},
      atoms = parserConfig.atoms || {},
      hooks = parserConfig.hooks || {},
      multiLineStrings = parserConfig.multiLineStrings;
  var isOperatorChar = /[+\-*&%=<>!?|\/~^]/

  var curPunc;

  function tokenBase(stream, state) {
    // If we just emitted the '#define' meta token, the next identifier is the macro name.
    if (state.definePhase === 'name') {
      state.definePhase = null;
      if (!stream.eol() && stream.match(/^[A-Za-z_]\w*/)) {
        state.definePhase = 'body';
        return "def";
      }
    }
    // Tokenize the body of a #define: %0-%9 as "variable-2", rest as "attribute".
    if (state.definePhase === 'body') {
      if (stream.eol()) { state.definePhase = null; return null; }
      if (stream.match(/^%%|^%[0-9]/)) {
        if (stream.eol()) state.definePhase = null;
        return "variable-2";
      }
      if (stream.peek() === '\\') {
        stream.next();
        if (stream.eol()) { return "attribute"; } // backslash continuation
        stream.next();
        return "attribute";
      }
      while (!stream.eol()) {
        var bc = stream.peek();
        if (bc === '%' || bc === '\\') break;
        stream.next();
      }
      if (stream.eol()) state.definePhase = null;
      return "attribute";
    }
    var ch = stream.next();
    if (hooks[ch]) {
      var result = hooks[ch](stream, state);
      if (result !== false) return result;
    }
    if (ch == "'") {
      // Pawn character literal: 'A', '\n', 'ab' — a cell value, not a string.
      while (!stream.eol()) {
        var nc = stream.next();
        if (nc === "'") break;
        if (nc === '\\' && !stream.eol()) stream.next();
      }
      return "number";
    }
    if (ch == '"') {
      state.tokenize = tokenString(ch);
      return state.tokenize(stream, state);
    }
    if (/[\[\]{}\(\),;\:]/.test(ch)) {
      curPunc = ch;
      return null;
    }
    if (ch == '.') {
      if (stream.match('..')) return "keyword";  // ... variadic
      return null;
    }
    if (/\d/.test(ch)) {
      if (ch === '0' && (stream.peek() === 'x' || stream.peek() === 'X')) {
        stream.next();
        stream.eatWhile(/[0-9a-fA-F]/);
      } else if (ch === '0' && (stream.peek() === 'b' || stream.peek() === 'B')) {
        stream.next();
        stream.eatWhile(/[01]/);
      } else {
        stream.eatWhile(/[\d_]/);
        if (stream.eat('.')) stream.eatWhile(/[\d_]/);
      }
      return "number";
    }
    if (ch == "/") {
      if (stream.eat("*")) {
        state.tokenize = tokenComment;
        return tokenComment(stream, state);
      }
      if (stream.eat("/")) {
        stream.skipToEnd();
        return "comment";
      }
    }
    if (isOperatorChar.test(ch)) {
      stream.eatWhile(isOperatorChar);
      return "operator";
    }
    stream.eatWhile(/[\w\$_]/);
    var cur = stream.current();
    if (keywords.propertyIsEnumerable(cur)) {
      if (blockKeywords.propertyIsEnumerable(cur)) curPunc = "newstatement";
      return "keyword";
    }
    if (builtin.propertyIsEnumerable(cur)) return "builtin";
    if (atoms.propertyIsEnumerable(cur)) return "atom";
    // ALL_CAPS_CONVENTION: 3+ char all-uppercase identifiers are user-defined
    // constants (#define values, enum members) not yet in the atoms list.
    if (/^[A-Z][A-Z0-9_]{2,}$/.test(cur)) return "atom";
    // Function definition: identifier followed by '(' after a declaration keyword
    // (forward/native/public/stock/static).  Tag annotations in between — e.g.
    // `public Float:Func(` — keep insideDecl set through the type token so Func
    // is still coloured green.
    if (state.insideDecl === 'func' && stream.peek() === '(') return "def";
    // Enum / methodmap name: the bare identifier immediately after the keyword.
    // Anonymous enum `enum { ... }` never reaches here — '{' clears insideDecl first.
    if (state.insideDecl === 'name') { state.insideDecl = false; return "def"; }
    // Pawn type tag: identifier immediately followed by ':' (e.g. Float:, bool:)
    // Skip for case/default labels so constants there aren't coloured as types.
    if (stream.peek() === ':' && state.lastKeyword !== 'case' && state.lastKeyword !== 'default') return "type";
    return "variable";
  }

  function tokenString(quote) {
    return function(stream, state) {
      var ch = stream.peek();

      // Escape sequence: \n \t \r \\ \" \' \0 \xNN …
      if (ch === '\\') {
        stream.next();
        if (!stream.eol()) {
          if (!stream.match(/^x[0-9a-fA-F]+/)) stream.next(); // \xNN or single-char
        }
        return "string-2";
      }

      // Printf format specifier: %d %5.2f %s %% …
      if (ch === '%' && stream.match(/^%[0-9*+\-.]*[disfecxhborgpqru%]/)) {
        return "string-2";
      }

      // SA-MP / open.mp embedded colour code: {RRGGBB} — e.g. "{FF0000}red {00FF00}green"
      if (ch === '{' && stream.match(/^\{[0-9A-Fa-f]{6}\}/)) {
        return "string-2";
      }

      if (ch === quote) {
        stream.next();
        state.tokenize = null;
        return "string";
      }

      // Regular string content — run until we need to yield a special token
      while (!stream.eol()) {
        var c = stream.next();
        if (c === quote) { state.tokenize = null; return "string"; }
        if (c === '\\') { stream.backUp(1); return "string"; }
        if (c === '%') {
          var pk = stream.peek();
          if (pk && /[0-9*+\-.disfecxhborgpqru%]/.test(pk)) {
            stream.backUp(1);
            return "string";
          }
        }
        if (c === '{' && stream.match(/^[0-9A-Fa-f]{6}\}/, false)) {
          stream.backUp(1);
          return "string";
        }
      }
      if (!multiLineStrings) state.tokenize = null;
      return "string";
    };
  }

  function tokenComment(stream, state) {
    var maybeEnd = false, ch;
    while (ch = stream.next()) {
      if (ch == "/" && maybeEnd) {
        state.tokenize = null;
        break;
      }
      maybeEnd = (ch == "*");
    }
    return "comment";
  }

  function Context(indented, column, type, align, prev) {
    this.indented = indented;
    this.column = column;
    this.type = type;
    this.align = align;
    this.prev = prev;
  }
  function pushContext(state, col, type) {
    var indent = state.indented;
    if (state.context && state.context.type == "statement")
      indent = state.context.indented;
    return state.context = new Context(indent, col, type, null, state.context);
  }
  function popContext(state) {
    var t = state.context.type;
    if (t == ")" || t == "]" || t == "}")
      state.indented = state.context.indented;
    return state.context = state.context.prev;
  }

  return {
    startState: function(basecolumn) {
      return {
        tokenize: null,
        context: new Context((basecolumn || 0) - indentUnit, 0, "top", false),
        indented: 0,
        startOfLine: true,
        lastKeyword: null,
        insideDecl: false,  // 'func'|'name'|false — set by decl keywords, cleared on non-type token
        definePhase: null   // 'name' — set by #define hook, consumed by tokenBase
      };
    },

    token: function(stream, state) {
      var ctx = state.context;
      if (stream.sol()) {
        if (ctx.align == null) ctx.align = false;
        state.indented = stream.indentation();
        state.startOfLine = true;
        if (state.definePhase === 'name') state.definePhase = null;  // clear orphaned #define-name state; 'body' persists for multi-line macros
      }
      if (stream.eatSpace()) return null;
      curPunc = null;
      var style = (state.tokenize || tokenBase)(stream, state);
      if (style == "comment" || style == "meta") return style;
      if (style == "keyword") {
        var kw = stream.current();
        state.lastKeyword = kw;
        // Track whether we're naming a function or a type (enum/methodmap).
        state.insideDecl = (kw === 'forward' || kw === 'native' || kw === 'public' ||
                            kw === 'stock'   || kw === 'static') ? 'func'
                         : (kw === 'enum'   || kw === 'methodmap')              ? 'name'
                         : false;
      } else if (style !== "type") {
        // A type tag (e.g. Float: in `native Float:GetX()`) keeps insideDecl alive
        // so the function name after the tag still gets coloured as "def".
        state.insideDecl = false;
      }
      if (ctx.align == null) ctx.align = true;

      if ((curPunc == ";" || curPunc == ":" || curPunc == ",") && ctx.type == "statement") popContext(state);
      else if (curPunc == "{") pushContext(state, stream.column(), "}");
      else if (curPunc == "[") pushContext(state, stream.column(), "]");
      else if (curPunc == "(") pushContext(state, stream.column(), ")");
      else if (curPunc == "}") {
        while (ctx.type == "statement") ctx = popContext(state);
        if (ctx.type == "}") ctx = popContext(state);
        while (ctx.type == "statement") ctx = popContext(state);
      }
      else if (curPunc == ctx.type) popContext(state);
      state.startOfLine = false;
      return style;
    },

    indent: function(state, textAfter) {
      if (state.tokenize != tokenBase && state.tokenize != null) return CodeMirror.Pass;
      var ctx = state.context, firstChar = textAfter && textAfter.charAt(0);
      if (ctx.type == "statement" && firstChar == "}") ctx = ctx.prev;
      var closing = firstChar == ctx.type;
      if (ctx.type == "statement") return ctx.indented + (firstChar == "{" ? 0 : statementIndentUnit);
      else if (ctx.align && (!dontAlignCalls || ctx.type != ")")) return ctx.column + (closing ? 0 : 1);
      else if (ctx.type == ")" && !closing) return ctx.indented + statementIndentUnit;
      else return ctx.indented + (closing ? 0 : indentUnit);
    },

    electricChars: "{}",
    blockCommentStart: "/*",
    blockCommentEnd: "*/",
    lineComment: "//",
    fold: "brace"
  };
});

(function() {
  function words(str) {
    var obj = {}, words = str.split(" ");
    for (var i = 0; i < words.length; ++i) obj[words[i]] = true;
    return obj;
  }

  // Consume the rest of a preprocessor line, honouring backslash continuations.
  function cppLineRest(stream, state) {
    for (;;) {
      if (stream.skipTo('\\')) {
        stream.next();
        if (stream.eol()) { state.tokenize = cppLineRest; break; }
      } else {
        stream.skipToEnd();
        state.tokenize = null;
        break;
      }
    }
    return "meta";
  }

  // Tokenises the body of a #define: %0-%9 and %% as "variable-2", rest as "attribute".
  function tokenDefineBody(stream, state) {
    if (stream.eol()) { state.tokenize = null; return null; }
    if (stream.match(/^%%|^%[0-9]/)) {
      if (stream.eol()) state.tokenize = null; // don't bleed into next line
      return "variable-2";
    }
    if (stream.peek() === '\\') {
      stream.next();
      if (stream.eol()) { state.tokenize = tokenDefineBody; return "attribute"; }
      stream.next();
      return "attribute";
    }
    while (!stream.eol()) {
      var c = stream.peek();
      if (c === '%' || c === '\\') break;
      stream.next();
    }
    if (stream.eol()) state.tokenize = null;
    return "attribute";
  }

  // Emits the path argument of #include (<file> or "file") as "string", rest as meta.
  function tokenIncludePath(stream, state) {
    stream.eatSpace();
    if (stream.eol()) { state.tokenize = null; return null; }
    var ch = stream.peek();
    if (ch === '<') {
      stream.next();
      stream.skipTo('>'); stream.next();
      state.tokenize = cppLineRest;
      return "link";
    }
    if (ch === '"') {
      stream.next();
      stream.skipTo('"'); stream.next();
      state.tokenize = cppLineRest;
      return "link";
    }
    // Unusual — fall back to meta.
    stream.skipToEnd(); state.tokenize = null; return "meta";
  }

  function cppHook(stream, state) {
    if (!state.startOfLine) return false;
    var m = stream.match(/^[a-z_]+/);  // eat directive name
    if (m && m[0] === 'define') {
      state.definePhase = 'name'; // tokenBase will consume the macro name as "def"
      return "meta";  // "#define" itself coloured meta
    }
    if (m && m[0] === 'include') {
      state.tokenize = tokenIncludePath;
      return "meta";  // "#include" coloured meta; path follows as string
    }
    // All other directives (#pragma, #if, …): consume as meta.
    for (;;) {
      if (stream.skipTo('\\')) {
        stream.next();
        if (stream.eol()) { state.tokenize = cppLineRest; break; }
      } else {
        stream.skipToEnd();
        state.tokenize = null;
        break;
      }
    }
    return "meta";
  }

  function def(mimes, mode) {
    var words = [];
    function add(obj) {
      if (obj) for (var prop in obj) if (obj.hasOwnProperty(prop))
        words.push(prop);
    }
    add(mode.keywords);
    add(mode.builtin);
    add(mode.atoms);
    if (words.length) {
      mode.helperType = mimes[0];
      CodeMirror.registerHelper("hintWords", mimes[0], words);
    }

    for (var i = 0; i < mimes.length; ++i)
      CodeMirror.defineMIME(mimes[i], mode);
  }

  def(["text/x-pawn"], {
    name: "pawn",
    keywords: words(
      // Control flow
      "break case continue default do else for goto if return switch while " +
      // Declarations
      "const enum forward native new operator public static stock " +
      // open.mp OOP (methodmaps)
      "methodmap property using intrinsic delete " +
      // Other keywords
      "assert char defined exit library sizeof sleep state tagof _"
    ),
    blockKeywords: words("case default do else for if switch while methodmap property"),
    builtin: words(
      // Console / output
      "printf print format " +
      // String functions
      "strlen strcat strcmp strfind strcopy strins strdel strtok strtrim " +
      "strpack strunpack ispacked strval valstr toupper tolower numericstr " +
      "memcpy " +
      // Float functions
      "float floatabs floatceil floatfloor floatround floatneg floatsqroot " +
      "floatpower floatlog floatsin floatcos floattan floatatan floatatan2 " +
      "floatdiv floatmul floatadd floatsub floatcmp floatstr floatint " +
      // Core / math
      "random clamp abs min max numargs getarg setarg heapspace funcidx " +
      // Properties
      "setproperty getproperty deleteproperty existproperty " +
      // Time / timers
      "gettime getdate SetTimer SetTimerEx KillTimer IsValidTimer IsTimerValid " +
      // File I/O
      "fopen fclose fwrite fread fgets fputs fseek ftell fflush flength fexist fmatch fremove frename " +
      // Timing
      "GetTickCount " +
      // Open.mp / SA-MP common server functions
      "SendClientMessage SendClientMessageToAll GameTextForPlayer GameTextForAll " +
      "SetPlayerPos GetPlayerPos SetPlayerFacingAngle GetPlayerFacingAngle " +
      "SetPlayerVelocity GetPlayerVelocity SetPlayerHealth GetPlayerHealth " +
      "SetPlayerArmour GetPlayerArmour SetPlayerScore GetPlayerScore " +
      "SetPlayerName GetPlayerName GetPlayerIp IsPlayerConnected IsPlayerInVehicle " +
      "SetPlayerColor GetPlayerColor GetPlayerState GetPlayerPing " +
      "Kick Ban BanEx IsPlayerAdmin IsPlayerNPC IsPlayerHuman " +
      "GetMaxPlayers GetPlayerPoolSize GetVehiclePoolSize GetActorPoolSize GetObjectPoolSize " +
      "GetPlayerVersion GetPlayerNetworkStats GetNetworkStats BlockIpAddress UnBlockIpAddress " +
      "SetPlayerTeam GetPlayerTeam " +
      "SetPlayerTime GetPlayerTime TogglePlayerClock " +
      "SetPlayerDrunkLevel GetPlayerDrunkLevel " +
      "SetPlayerFightingStyle GetPlayerFightingStyle " +
      "IsPlayerStreamedIn GetPlayerKeys SetPlayerAmmo SetPlayerSkillLevel " +
      "SetPlayerCheckpoint DisablePlayerCheckpoint IsPlayerInCheckpoint IsPlayerCheckpointActive GetPlayerCheckpoint " +
      "SetPlayerRaceCheckpoint DisablePlayerRaceCheckpoint IsPlayerInRaceCheckpoint IsPlayerRaceCheckpointActive GetPlayerRaceCheckpoint " +
      "UsePlayerPedAnims AllowInteriorWeapons SetPlayerWorldBounds " +
      "PutPlayerInVehicle RemovePlayerFromVehicle GetVehicleModel " +
      "IsValidVehicle LinkVehicleToInterior " +
      "AddVehicleComponent RemoveVehicleComponent GetVehicleComponentInSlot GetVehicleComponentType " +
      "SetVehicleParamsForPlayer SetVehicleParamsEx GetVehicleParamsSirenState SetVehicleParamsSirenState " +
      "GetVehicleModelInfo GetVehicleRotationQuat SetVehicleDamageStatus GetVehicleDamageStatus " +
      "AttachTrailerToVehicle DetachTrailerFromVehicle IsTrailerAttached GetVehicleTrailer " +
      "CreateVehicle DestroyVehicle IsVehicleStreamedIn AddStaticVehicle " +
      "SelectObject EditObject EditPlayerObject CancelEdit " +
      "SelectTextDraw CancelSelectTextDraw " +
      "IsValidObject CreateObject DestroyObject MoveObject StopObject IsObjectMoving AttachObjectToVehicle " +
      "SetObjectPos GetObjectPos SetObjectRot GetObjectRot " +
      "SetObjectMaterial SetObjectMaterialText SetObjectNoCameraCol SetObjectsDefaultCameraCol " +
      "CreatePlayerObject DestroyPlayerObject IsValidPlayerObject " +
      "MovePlayerObject StopPlayerObject IsPlayerObjectMoving " +
      "SetPlayerObjectPos GetPlayerObjectPos SetPlayerObjectRot GetPlayerObjectRot " +
      "AttachPlayerObjectToVehicle AttachPlayerObjectToPlayer " +
      "SetPlayerObjectMaterial SetPlayerObjectMaterialText " +
      "SetPlayerAttachedObject RemovePlayerAttachedObject IsPlayerAttachedObjectSlotUsed " +
      "GetPlayerAttachedObject EditAttachedObject " +
      "AddPlayerClass SpawnPlayer SetSpawnInfo " +
      "ShowPlayerDialog GetPlayerDialog " +
      "CreateActor DestroyActor IsActorStreamedIn IsValidActor " +
      "SetActorPos GetActorPos SetActorFacingAngle GetActorFacingAngle " +
      "SetActorHealth GetActorHealth SetActorVirtualWorld GetActorVirtualWorld " +
      "SetActorInvulnerable IsActorInvulnerable SetActorSkin GetActorSkin " +
      "ApplyActorAnimation ClearActorAnimations GetActorAnimation GetActorSpawnInfo " +
      "DisableInteriorEnterExits SetPlayerInterior GetPlayerInterior " +
      "SetPlayerVirtualWorld GetPlayerVirtualWorld " +
      "SetWorldTime SetWeather SetGravity " +
      "ApplyAnimation ClearAnimations GetAnimationName " +
      "CallLocalFunction CallRemoteFunction " +
      "SetPlayerSkin GetPlayerSkin SetPlayerSpecialAction GetPlayerSpecialAction " +
      "GivePlayerWeapon ResetPlayerWeapons GetPlayerWeapon GetPlayerAmmo GetPlayerWeaponData " +
      "GivePlayerMoney GetPlayerMoney ResetPlayerMoney " +
      "SetPlayerCameraPos SetPlayerCameraLookAt SetCameraBehindPlayer " +
      "InterpolateCameraPos InterpolateCameraLookAt " +
      "GetPlayerCameraPos GetPlayerCameraFrontVector GetPlayerCameraMode " +
      "GetPlayerSurfingVehicleID GetPlayerSurfingObjectID " +
      "GetPlayerLastShotVectors " +
      "ConnectNPC " +
      "PlayerPlaySound PlayAudioStreamForPlayer StopAudioStreamForPlayer " +
      "CreateExplosion SetPlayerMapIcon RemovePlayerMapIcon " +
      "CreatePickup AddStaticPickup DestroyPickup " +
      "TextDrawCreate TextDrawDestroy TextDrawLetterSize TextDrawTextSize " +
      "TextDrawAlignment TextDrawColor TextDrawUseBox TextDrawBoxColor " +
      "TextDrawShadow TextDrawOutline TextDrawBackgroundColor TextDrawFont " +
      "TextDrawSetProportional TextDrawSetString " +
      "TextDrawSetPreviewModel TextDrawSetPreviewRot TextDrawSetPreviewVehCol " +
      "TextDrawShowForPlayer TextDrawHideForPlayer TextDrawShowForAll TextDrawHideForAll " +
      "CreatePlayerTextDraw PlayerTextDrawDestroy PlayerTextDrawLetterSize " +
      "PlayerTextDrawAlignment PlayerTextDrawColor PlayerTextDrawUseBox " +
      "PlayerTextDrawBoxColor PlayerTextDrawShadow PlayerTextDrawOutline " +
      "PlayerTextDrawBackgroundColor PlayerTextDrawFont PlayerTextDrawSetProportional " +
      "PlayerTextDrawShow PlayerTextDrawHide PlayerTextDrawSetString " +
      "PlayerTextDrawSetPreviewModel PlayerTextDrawSetPreviewRot PlayerTextDrawSetPreviewVehCol " +
      "GangZoneCreate GangZoneDestroy " +
      "GangZoneShowForPlayer GangZoneShowForAll GangZoneHideForPlayer GangZoneHideForAll " +
      "GangZoneFlashForPlayer GangZoneFlashForAll " +
      "GangZoneStopFlashForPlayer GangZoneStopFlashForAll " +
      "Create3DTextLabel Delete3DTextLabel Attach3DTextLabelToPlayer Attach3DTextLabelToVehicle " +
      "Update3DTextLabelText CreatePlayer3DTextLabel DeletePlayer3DTextLabel UpdatePlayer3DTextLabelText " +
      "CreateMenu DestroyMenu AddMenuItem ShowMenuForPlayer HideMenuForPlayer " +
      "SetGameModeText SetMaxPlayers ShowNameTags ShowPlayerMarkers " +
      "SetPlayerSkillLevel SetPlayerChatBubble " +
      "GetVehiclePos GetVehicleZAngle SetVehiclePos SetVehicleZAngle " +
      "SetVehicleHealth GetVehicleHealth SetVehicleVelocity GetVehicleVelocity " +
      "SetVehicleNumberPlate RepairVehicle SetVehicleToRespawn " +
      "db_open db_close db_query db_free_result db_get_field db_num_rows db_next_row " +
      "db_num_fields db_field_name db_free_result db_get_field_assoc db_get_mem_handle db_get_result_mem_handle " +
      // Server / player variables
      "SetSVarInt GetSVarInt SetSVarString GetSVarString SetSVarFloat GetSVarFloat " +
      "DeleteSVar GetSVarsUpperIndex GetSVarNameAtIndex GetSVarType " +
      "SetPVarInt GetPVarInt SetPVarString GetPVarString SetPVarFloat GetPVarFloat " +
      "DeletePVar GetPVarsUpperIndex GetPVarNameAtIndex GetPVarType " +
      "SHA256_PassHash"
    ),
    atoms: words(
      // Pawn language constants
      "true false null EOS __Pawn " +
      "cellbits cellmax cellmin charbits charmax charmin ucharmax " +
      "debug overlaysize " +
      // Open.mp / SA-MP commonly used constants
      "MAX_PLAYERS INVALID_PLAYER_ID MAX_VEHICLES INVALID_VEHICLE_ID " +
      "MAX_OBJECTS INVALID_OBJECT_ID MAX_ACTORS INVALID_ACTOR_ID " +
      "MAX_GANG_ZONES MAX_MENUS INVALID_MENU " +
      "MAX_TEXT_DRAWS INVALID_TEXT_DRAW " +
      "MAX_3DTEXT_GLOBAL INVALID_3DTEXT_ID " +
      "MAX_PICKUPS INVALID_PICKUP " +
      "INVALID_TIMER " +
      // Player states
      "PLAYER_STATE_NONE PLAYER_STATE_ONFOOT PLAYER_STATE_DRIVER " +
      "PLAYER_STATE_PASSENGER PLAYER_STATE_EXIT_VEHICLE PLAYER_STATE_ENTER_VEHICLE_DRIVER " +
      "PLAYER_STATE_ENTER_VEHICLE_PASSENGER PLAYER_STATE_WASTED PLAYER_STATE_SPAWNED " +
      "PLAYER_STATE_SPECTATING " +
      // Dialog styles
      "DIALOG_STYLE_MSGBOX DIALOG_STYLE_INPUT DIALOG_STYLE_LIST DIALOG_STYLE_PASSWORD " +
      "DIALOG_STYLE_TABLIST DIALOG_STYLE_TABLIST_HEADERS " +
      // Key constants
      "KEY_FIRE KEY_SPRINT KEY_JUMP KEY_CROUCH KEY_ACTION KEY_SECONDARY_ATTACK KEY_RELOAD " +
      "KEY_LOOK_RIGHT KEY_HANDBRAKE KEY_LOOK_LEFT KEY_SUBMISSION KEY_LOOK_BEHIND " +
      "KEY_WALK KEY_ANALOG_UP KEY_ANALOG_DOWN KEY_ANALOG_LEFT KEY_ANALOG_RIGHT " +
      "KEY_YES KEY_NO KEY_CTRL_BACK KEY_UP KEY_DOWN " +
      // Special actions
      "SPECIAL_ACTION_NONE SPECIAL_ACTION_DUCK SPECIAL_ACTION_USEJETPACK " +
      "SPECIAL_ACTION_ENTER_VEHICLE SPECIAL_ACTION_EXIT_VEHICLE " +
      "SPECIAL_ACTION_DANCE1 SPECIAL_ACTION_DANCE2 SPECIAL_ACTION_DANCE3 SPECIAL_ACTION_DANCE4 " +
      "SPECIAL_ACTION_HANDSUP SPECIAL_ACTION_USECELLPHONE SPECIAL_ACTION_SITTING SPECIAL_ACTION_STOPUSECELLPHONE " +
      "SPECIAL_ACTION_DRINK_BEER SPECIAL_ACTION_SMOKE_CIGGY SPECIAL_ACTION_DRINK_WINE SPECIAL_ACTION_DRINK_SPRUNK " +
      "SPECIAL_ACTION_CUFFED SPECIAL_ACTION_CARRY SPECIAL_ACTION_PISSING " +
      // Marker modes / name-tag distances
      "PLAYER_MARKERS_MODE_OFF PLAYER_MARKERS_MODE_GLOBAL PLAYER_MARKERS_MODE_STREAMED " +
      // Fight styles
      "FIGHT_STYLE_NORMAL FIGHT_STYLE_BOXING FIGHT_STYLE_KUNGFU " +
      "FIGHT_STYLE_KNEEHEAD FIGHT_STYLE_GRABKICK FIGHT_STYLE_ELBOW " +
      // Variable types (PVar / SVar)
      "VARTYPE_NONE VARTYPE_INT VARTYPE_STRING VARTYPE_FLOAT " +
      // Object material types
      "OBJECT_MATERIAL_TYPE_NONE OBJECT_MATERIAL_TYPE_TEXTURE OBJECT_MATERIAL_TYPE_TEXT " +
      // General
      "NO_TEAM MAX_PLAYER_NAME MAX_CHATBUBBLE_LENGTH MAX_PLAYER_ATTACHED_OBJECTS " +
      // Weapon IDs
      "WEAPON_UNARMED WEAPON_BRASSKNUCKLE WEAPON_GOLFCLUB WEAPON_NITESTICK WEAPON_KNIFE " +
      "WEAPON_BAT WEAPON_SHOVEL WEAPON_POOLSTICK WEAPON_KATANA WEAPON_CHAINSAW " +
      "WEAPON_GRENADE WEAPON_TEARGAS WEAPON_MOLTOV " +
      "WEAPON_PISTOL WEAPON_SILENCED_PISTOL WEAPON_DESERT_EAGLE " +
      "WEAPON_SHOTGUN WEAPON_SAWEDOFF_SHOTGUN WEAPON_SHOTGSPA " +
      "WEAPON_MICRO_UZI WEAPON_MP5 WEAPON_AK47 WEAPON_M4 WEAPON_TEC9 " +
      "WEAPON_COUNTRYRIFLE WEAPON_SNIPERRIFLE " +
      "WEAPON_ROCKETLAUNCHER WEAPON_HEATSEEKER WEAPON_FLAMETHROWER WEAPON_MINIGUN " +
      "WEAPON_SATCHEL WEAPON_BOMB WEAPON_SPRAYCAN WEAPON_FIREEXTINGUISHER " +
      "WEAPON_CAMERA WEAPON_NIGHTVISION WEAPON_INFRARED WEAPON_PARACHUTE WEAPON_VEHICLE " +
      // Body parts
      "BODY_PART_TORSO BODY_PART_GROIN BODY_PART_LEFT_ARM BODY_PART_RIGHT_ARM " +
      "BODY_PART_LEFT_LEG BODY_PART_RIGHT_LEG BODY_PART_HEAD " +
      // Camera
      "CAMERA_CUT CAMERA_MOVE " +
      // Object edit / select response
      "EDIT_RESPONSE_CANCEL EDIT_RESPONSE_FINAL EDIT_RESPONSE_UPDATE " +
      "SELECT_OBJECT_GLOBAL_OBJECT SELECT_OBJECT_PLAYER_OBJECT " +
      // Bullet hit types
      "BULLET_HIT_TYPE_NONE BULLET_HIT_TYPE_PLAYER BULLET_HIT_TYPE_VEHICLE " +
      "BULLET_HIT_TYPE_OBJECT BULLET_HIT_TYPE_PLAYER_OBJECT BULLET_HIT_TYPE_SELF_VEHICLE " +
      // Player click source
      "CLICK_SOURCE_SCOREBOARD " +
      // Race checkpoint types (CP_TYPE)
      "CP_TYPE_GROUND_NORMAL CP_TYPE_GROUND_FINISH CP_TYPE_GROUND_EMPTY " +
      "CP_TYPE_AIR_NORMAL CP_TYPE_AIR_FINISH CP_TYPE_AIR_ROTATING CP_TYPE_AIR_STROBING CP_TYPE_AIR_SWINGING CP_TYPE_AIR_BOBBING " +
      // Map icons
      "MAPICON_LOCAL MAPICON_GLOBAL MAPICON_LOCAL_CHECKPOINT MAPICON_GLOBAL_CHECKPOINT " +
      // Vehicle params
      "VEHICLEPARAMS_UNSET VEHICLEPARAMS_OFF VEHICLEPARAMS_ON " +
      // Player recording types
      "PLAYER_RECORDING_TYPE_NONE PLAYER_RECORDING_TYPE_DRIVER PLAYER_RECORDING_TYPE_ONFOOT " +
      // Object material sizes
      "OBJECT_MATERIAL_SIZE_32x32 OBJECT_MATERIAL_SIZE_64x32 OBJECT_MATERIAL_SIZE_64x64 " +
      "OBJECT_MATERIAL_SIZE_128x32 OBJECT_MATERIAL_SIZE_128x64 OBJECT_MATERIAL_SIZE_128x128 " +
      "OBJECT_MATERIAL_SIZE_256x32 OBJECT_MATERIAL_SIZE_256x64 OBJECT_MATERIAL_SIZE_256x128 " +
      "OBJECT_MATERIAL_SIZE_256x256 OBJECT_MATERIAL_SIZE_512x64 OBJECT_MATERIAL_SIZE_512x128 " +
      "OBJECT_MATERIAL_SIZE_512x256 OBJECT_MATERIAL_SIZE_512x512 " +
      "OBJECT_MATERIAL_TEXT_ALIGN_LEFT OBJECT_MATERIAL_TEXT_ALIGN_CENTER OBJECT_MATERIAL_TEXT_ALIGN_RIGHT " +
      // Compiler magic constants
      "__LINE__ __FILE__ __DATE__ __TIME__ __FUNCTION__"
    ),
    hooks: {"#": cppHook},
    modeProps: {fold: ["brace", "include"]}
  });
}());
});
