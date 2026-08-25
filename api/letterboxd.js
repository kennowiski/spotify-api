import { XMLParser } from 'fast-xml-parser';
import { applyCors } from './_lib/cors.js';
import { createRateLimiter } from './_lib/rateLimit.js';

const checkRateLimit = createRateLimiter(10, 60 * 1000); // 10 req/min por IP

const FALLBACK_POSTER = 'https://s.ltrbxd.com/static/img/empty-poster-250.8491d904.png';

// Pega o texto de um campo do RSS (vem como string ou como
// { __cdata: '...' } quando o feed usa CDATA)
function readField(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object' && '__cdata' in value) return String(value.__cdata).trim();
  return String(value).trim();
}

export default async function handler(req, res) {
  if (applyCors(req, res, { methods: 'GET, OPTIONS' })) {
    return;
  }

  const rate = checkRateLimit(req);

  if (rate.limited) {
    res.setHeader('Retry-After', String(rate.retryAfterSeconds));
    return res.status(429).json({
      error: 'Muitas requisições. Tente novamente em instantes.',
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const response = await fetch('https://letterboxd.com/kennowiski/rss/', {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    if (!response.ok) {
      return res.status(502).json({
        error: 'Falha ao buscar o RSS do Letterboxd',
        status: response.status
      });
    }

    const xmlText = await response.text();

    const parser = new XMLParser({
      ignoreAttributes: true,
      cdataPropName: '__cdata',
      textNodeName: '__text'
    });

    const parsed = parser.parse(xmlText);
    const items = parsed?.rss?.channel?.item;
    const firstItem = Array.isArray(items) ? items[0] : items;

    if (!firstItem) {
      return res.status(200).json({
        error: 'Nenhum filme encontrado'
      });
    }

    const title = readField(firstItem.title).replace(', watched by kennowiski', '');
    const link = readField(firstItem.link);
    const description = readField(firstItem.description);

    const imgMatch = description.match(/<img[^>]+src="([^"]+)"/);
    const poster = imgMatch ? imgMatch[1] : FALLBACK_POSTER;

    return res.status(200).json({
      title,
      link,
      poster
    });

  } catch (error) {
    return res.status(500).json({
      error: error.message
    });
  }
}
