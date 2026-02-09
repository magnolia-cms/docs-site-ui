'use strict'

module.exports = (...args) => {
  // Handlebars passes options as the last argument
  const options = args[args.length - 1]
  // If last arg is the options object (has hash property), remove it
  const actualArgs = (options && typeof options === 'object' && options.hash)
    ? args.slice(0, -1)
    : args

  if (actualArgs.length < 3) {
    throw new Error('{{replace}} helper expects 3 arguments: string, search, replacement')
  }

  const [str, search] = actualArgs
  let replacement = actualArgs[2]

  if (!str) return ''
  if (!search) return str
  if (replacement === undefined || replacement === null) replacement = ''

  return String(str).split(String(search)).join(String(replacement))
}
