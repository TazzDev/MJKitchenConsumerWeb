// The payment QR, drawn in the browser from the order's upi:// link (no external
// service). It is saved as a small card with the amount and order number on it,
// so it still makes sense when picked from the gallery later.

export interface QrCard {
  link: string
  amount: string
  code: string
  payeeName: string
  upiId: string
}

export async function qrCardPng(card: QrCard): Promise<string> {
  const QRCode = (await import('qrcode')).default
  const qr = document.createElement('canvas')
  await QRCode.toCanvas(qr, card.link, { errorCorrectionLevel: 'M', margin: 0, width: 520, color: { dark: '#1a3627', light: '#ffffff' } })

  const W = 640
  const H = 900
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  g.fillStyle = '#f2e5c8'
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#ffffff'
  roundRect(g, 32, 150, W - 64, 600, 28)
  g.fill()
  g.drawImage(qr, (W - 520) / 2, 190)

  g.textAlign = 'center'
  g.fillStyle = '#234734'
  g.font = 'bold 44px Georgia, serif'
  g.fillText('MJ Kitchen', W / 2, 70)
  g.font = '600 26px system-ui, sans-serif'
  g.fillStyle = '#6a432a'
  g.fillText(`Order ${card.code}`, W / 2, 115)

  g.fillStyle = '#8b2e20'
  g.font = 'bold 52px system-ui, sans-serif'
  g.fillText(`Pay ${card.amount}`, W / 2, 815)
  g.fillStyle = '#6a432a'
  g.font = '24px system-ui, sans-serif'
  g.fillText(`${card.payeeName} · ${card.upiId}`, W / 2, 860, W - 48)
  return c.toDataURL('image/png')
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}
