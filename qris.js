// qris.js — Build a dynamic QRIS string + QR code image.
// Mirrors Gopayment's buildDynamicQris (turns a static QRIS string into a
// dynamic one by injecting a nominal field and recomputing CRC16).
import QRCode from 'qrcode';

// CRC16-CCITT (0xFFFF init, polynomial 0x1021), same as Gopayment uses.
function crc16ccitt(buf) {
  let crc = 0xffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i] << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc;
}

export function buildDynamicQris(staticQris, amount) {
  if (!staticQris || typeof staticQris !== 'string' || staticQris.length < 10) {
    throw new Error('QRIS_STRING tidak valid.');
  }
  const trimmed = staticQris.trim();
  const data = trimmed.endsWith('6304') ? trimmed : trimmed.slice(0, -4);
  const step1 = data.replace('010211', '010212'); // static -> dynamic
  if (!step1.includes('5802ID')) throw new Error('Format QRIS tidak valid.');

  const amountStr = String(amount);
  const [before, after] = step1.split('5802ID');
  const nominalField = '54' + String(amountStr.length).padStart(2, '0') + amountStr;
  const raw = before + nominalField + '5802ID' + after;
  const crc = crc16ccitt(Buffer.from(raw, 'utf8')).toString(16).toUpperCase().padStart(4, '0');
  return raw + crc;
}

export async function qrisToDataUrl(dynamicQris) {
  return await QRCode.toDataURL(dynamicQris, { scale: 8, errorCorrectionLevel: 'M', margin: 2 });
}

// Validate a QRIS string looks plausible (has merchant + country fields)
export function validateQrisString(qris) {
  return typeof qris === 'string' && qris.includes('000201') && qris.includes('5802ID');
}
