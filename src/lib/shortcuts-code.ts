// CommonMark fenced blocks: backticks or tildes, at most three leading spaces,
// with a closing fence at least as long as the opening fence.
export function lastFencedCodeBlock(text: string): string | null {
  const lines = text.split(/\r?\n/)
  let fence: string | null = null
  let content: Array<string> = []
  let indent = 0
  let last: string | null = null
  for (const line of lines) {
    if (!fence) {
      const opening = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line)
      if (!opening || (opening[2][0] === '`' && opening[3].includes('`')))
        continue
      fence = opening[2]
      indent = opening[1].length
      content = []
    } else {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
      if (
        closing &&
        closing[1][0] === fence[0] &&
        closing[1].length >= fence.length
      ) {
        last = content.join('\n')
        fence = null
      } else {
        content.push(line.replace(new RegExp(`^ {0,${indent}}`), ''))
      }
    }
  }
  // An unfinished fence extends to the end of the turn (including streaming).
  return fence ? content.join('\n') : last
}
