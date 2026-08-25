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
      textNodeName: '__text',
      removeNSPrefix: false
    });

    const parsed = parser.parse(xmlText);
    const items = parsed?.rss?.channel?.item;
    const firstItem = Array.isArray(items) ? items[0] : items;

    if (!firstItem) {
      return res.status(200).json({
        error: 'Nenhum filme encontrado'
      });
    }

    const originalTitle = readField(firstItem.title).replace(', watched by kennowiski', '');
    const link = readField(firstItem.link);
    const description = readField(firstItem.description);
    const filmYear = readField(firstItem['letterboxd:filmYear']);
    const tmdbId = readField(firstItem['tmdb:movieId']);

    const imgMatch = description.match(/<img[^>]+src="([^"]+)"/);
    const poster = imgMatch ? imgMatch[1] : FALLBACK_POSTER;

    let title = originalTitle;
    const TMDB_KEY = process.env.TMDB_API_KEY;

    // O Letterboxd embute a nota do usuário no fim do título (ex: "Nome, 2026 - ★★★").
    // Preserva esse sufixo pro front-end continuar extraindo as estrelas certinho.
    const ratingMatch = originalTitle.match(/\s*[-–—:|•·]\s*([★☆½]+)\s*$/);
    const ratingSuffix = ratingMatch ? ` - ${ratingMatch[1]}` : '';

    // Busca o título oficial em português na TMDB, mesma fonte usada no bloco de séries
    if (tmdbId && TMDB_KEY) {
      try {
        const tmdbResponse = await fetch(
          `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&language=pt-BR`
        );
        if (tmdbResponse.ok) {
          const tmdbText = await tmdbResponse.text();
          if ((tmdbResponse.headers.get('content-type') || '').includes('application/json')) {
            const tmdbData = JSON.parse(tmdbText);
            if (tmdbData.title) {
              title = filmYear
                ? `${tmdbData.title}, ${filmYear}${ratingSuffix}`
                : `${tmdbData.title}${ratingSuffix}`;
            }
          }
        }
      } catch (tmdbError) {
        console.error('Erro ao buscar título em pt-BR na TMDB:', tmdbError.message);
      }
    }

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
