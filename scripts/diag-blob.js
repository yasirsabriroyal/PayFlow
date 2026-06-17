// Repro: does a PRIVATE blob upload work on this store/token?
// The compliance upload uses access:'private'. If the store doesn't support
// private blobs, this will throw — revealing the real failure.
const { put } = require('@vercel/blob')

async function main() {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  console.log('[v0] token present:', !!token, 'prefix:', token ? token.slice(0, 20) : 'none')

  const body = Buffer.from('hello private world ' + Date.now())

  try {
    console.log('[v0] attempting access:private put...')
    const res = await put(`compliance/_diag-private-${Date.now()}.txt`, body, {
      access: 'private',
      token,
      addRandomSuffix: true,
      contentType: 'text/plain',
    })
    console.log('[v0] PRIVATE OK:', JSON.stringify(res, null, 2))
  } catch (e) {
    console.log('[v0] PRIVATE FAILED:', e && e.name, '-', e && e.message)
  }

  try {
    console.log('[v0] attempting access:public put (control)...')
    const res2 = await put(`compliance/_diag-public-${Date.now()}.txt`, body, {
      access: 'public',
      token,
      addRandomSuffix: true,
      contentType: 'text/plain',
    })
    console.log('[v0] PUBLIC OK pathname:', res2.pathname)
  } catch (e) {
    console.log('[v0] PUBLIC FAILED:', e && e.name, '-', e && e.message)
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
