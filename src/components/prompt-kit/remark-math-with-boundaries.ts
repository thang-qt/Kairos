import remarkMath from 'remark-math'
import type {} from 'remark-parse'
import type {} from 'micromark-extension-math'
import type { Code, Construct, Effects, State } from 'micromark-util-types'
import type { Processor } from 'unified'

function isWhitespace(code: Code): boolean {
  return code !== null && (code < 0 || /\s/u.test(String.fromCodePoint(code)))
}

function isDigit(code: Code): boolean {
  return code !== null && code >= 48 && code <= 57
}

/**
 * Single dollars follow Pandoc's whitespace/digit boundaries. Like
 * markdown-it-katex, an invalid first closer rejects the pair: it must never
 * skip a price's dollar and consume a later equation instead.
 */
function tokenizeInlineMath(effects: Effects, ok: State, nok: State): State {
  let previous: Code = null
  let escaped = false
  return start

  function start(code: Code): State {
    effects.enter('mathText')
    effects.enter('mathTextSequence')
    effects.consume(code)
    effects.exit('mathTextSequence')
    return open
  }

  function open(code: Code): State | undefined {
    if (code === null || code === 36 || isWhitespace(code)) return nok(code)
    effects.enter('mathTextData')
    return data(code)
  }

  function data(code: Code): State | undefined {
    // Single-dollar expressions stay within a line. Display math continues to
    // use remark-math's upstream tokenizer.
    if (code === null || (code < 0 && code !== -1 && code !== -2)) {
      return nok(code)
    }
    if (code === 36 && !escaped) {
      if (isWhitespace(previous)) return nok(code)
      effects.exit('mathTextData')
      effects.enter('mathTextSequence')
      effects.consume(code)
      effects.exit('mathTextSequence')
      return close
    }
    effects.consume(code)
    escaped = code === 92 && !escaped
    previous = code
    return data
  }

  function close(code: Code): State | undefined {
    if (code === 36 || isDigit(code)) return nok(code)
    effects.exit('mathText')
    return ok(code)
  }
}

const inlineMath: Construct = {
  name: 'mathText',
  tokenize: tokenizeInlineMath,
  previous: function (code) {
    return code !== 36 || this.events.at(-1)?.[1].type === 'characterEscape'
  },
}

export function remarkMathWithBoundaries(this: Processor): void {
  remarkMath.call(this, { singleDollarTextMath: false })
  const data = this.data()
  const extensions = data.micromarkExtensions ?? (data.micromarkExtensions = [])
  extensions.push({ text: { 36: inlineMath } })
}
