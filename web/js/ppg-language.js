import {StreamLanguage, HighlightStyle, foldService, matchBrackets, ensureSyntaxTree, syntaxTree} from '@codemirror/language';
import {Tag, highlightTree} from '@lezer/highlight';
import {createPawnParser, pawnConfig} from './pawn-language.js';
import {createPawnAsmParser, pawnAsmConfig} from './pawn-asm-language.js';

const colours = {
  keyword: '#C4A7E7', builtin: '#88C0D0', def: '#88C0D0',
  string: '#A8D5A2', 'string-2': '#A8D5A2', link: '#A8D5A2',
  number: '#E8BA88', meta: '#B69DF0', atom: '#E5C38B', 'variable-2': '#E5C38B',
  variable: '#D6D9E3', operator: '#D6D9E3', attribute: '#D6D9E3', type: '#D6D9E3',
  comment: '#808A9C'
};
const tokenTable = Object.fromEntries(Object.keys(colours).map(name => [`pawn-${name}`, Tag.define()]));
export const pawnHighlightStyle = HighlightStyle.define(Object.entries(colours).map(([name, color]) => ({
  tag: tokenTable[`pawn-${name}`], color, class: `cm-${name}`
})));

function copyContext(context) {
  return context ? {...context, prev: copyContext(context.prev)} : null;
}
function makeLanguage(createParser, config) {
  const mode = createParser({indentUnit: 4}, config);
  return StreamLanguage.define({
    ...mode,
    name: config.name,
    // CM6 passes the indentation unit here; the old mode expects a base column.
    startState() { return mode.startState(); },
    tokenTable,
    token(stream, state) {
      const token = mode.token(stream, state);
      return token ? token.split(' ').map(name => `pawn-${name}`).join(' ') : null;
    },
    copyState(state) {
      return {...state, context: copyContext(state.context), macros: state.macros?.slice()};
    },
    languageData: {
      commentTokens: {line: '//', block: {open: '/*', close: '*/'}},
      indentOnInput: /^\s*[{}]$/
    }
  });
}
export const pawnLanguage = makeLanguage(createPawnParser, pawnConfig);
export const pawnAsmLanguage = makeLanguage(createPawnAsmParser, pawnAsmConfig);
export const pawnCompletions = [
  ...Object.keys(pawnConfig.keywords).map(label => ({label, type: 'keyword'})),
  ...Object.keys(pawnConfig.builtin).map(label => ({label, type: 'function'})),
  ...Object.keys(pawnConfig.atoms).map(label => ({label, type: 'constant'}))
];

// The listing and assembly panels use the same CM6 parsers and highlight style.
export function highlightCode(value, mime, node) {
  const language = mime === 'text/x-pawn-asm' ? pawnAsmLanguage : pawnLanguage;
  const fragment = document.createDocumentFragment();
  let offset = 0;
  highlightTree(language.parser.parse(value), pawnHighlightStyle, (from, to, classes) => {
    if (from > offset) fragment.append(document.createTextNode(value.slice(offset, from)));
    const span = document.createElement('span');
    span.className = classes;
    span.textContent = value.slice(from, to);
    fragment.append(span);
    offset = to;
  });
  fragment.append(document.createTextNode(value.slice(offset)));
  node.replaceChildren(fragment);
}

export const pawnFolding = foldService.of((state, from, to) => {
  const line = state.doc.sliceString(from, to);
  if (/^\s*#(?:try)?include\b/.test(line)) {
    let last = state.doc.lineAt(to).number;
    while (last < state.doc.lines && /^\s*#(?:try)?include\b/.test(state.doc.line(last + 1).text)) last++;
    const end = state.doc.line(last).to;
    return end > to ? {from: to, to: end} : null;
  }
  const tree = ensureSyntaxTree(state, to, 50) || syntaxTree(state);
  const commentStart = line.indexOf('/*');
  if (commentStart >= 0 && /comment/.test(tree.resolveInner(from + commentStart, 1).name)) {
    const end = state.doc.toString().indexOf('*/', from + commentStart + 2);
    if (end >= 0 && state.doc.lineAt(end).number > state.doc.lineAt(from).number) {
      return {from: from + commentStart + 2, to: end};
    }
  }
  // Stream trees do not contain structural brace nodes. Match only real code
  // braces; the bracket matcher excludes braces inside strings and comments.
  for (let pos = to - 1; pos >= from; pos--) {
    if (state.doc.sliceString(pos, pos + 1) !== '{') continue;
    if (/comment|string|link/.test(tree.resolveInner(pos, 1).name)) continue;
    const match = matchBrackets(state, pos, 1, {brackets: '{}', maxScanDistance: state.doc.length});
    if (match?.matched && match.end && state.doc.lineAt(match.end.from).number > state.doc.lineAt(from).number) {
      return {from: pos + 1, to: match.end.from};
    }
  }
  return null;
});
