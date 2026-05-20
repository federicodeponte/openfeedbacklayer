import assert from 'node:assert/strict'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { FeedbackWidget } from '../dist/index.mjs'

const html = renderToString(
  React.createElement(
    React.Fragment,
    null,
    React.createElement(FeedbackWidget, { nonce: 'test-nonce', primaryColor: '#123456' }),
    React.createElement(FeedbackWidget, { nonce: 'test-nonce', position: 'top-left' }),
  ),
)

assert.match(html, /<style nonce="test-nonce">/)
assert.doesNotMatch(html, /\sstyle=/)

const containerScopes = [...html.matchAll(/class="[^"]*\bofl-([A-Za-z0-9_-]+)-container\b/g)].map((match) => match[1])
assert.equal(containerScopes.length, 2)
assert.equal(new Set(containerScopes).size, 2)

for (const scope of containerScopes) {
  assert.match(html, new RegExp(`\\.ofl-${scope}-container \\{`))
  assert.match(html, new RegExp(`\\.ofl-${scope}-button \\{`))
}

console.log('widget render snapshot OK')
