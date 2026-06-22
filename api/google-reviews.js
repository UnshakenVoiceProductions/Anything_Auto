const DEFAULT_TEXT_QUERY = process.env.GOOGLE_PLACE_TEXT_QUERY || 'Anything Automotive LLC 201 Cowanshannock Ave Rural Valley PA 16249';

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

async function textSearch(apiKey) {
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress'
    },
    body: JSON.stringify({
      textQuery: DEFAULT_TEXT_QUERY,
      pageSize: 1
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Google Text Search failed: ${response.status} ${message}`);
  }

  const data = await response.json();
  return data?.places?.[0] || null;
}

async function placeDetails(apiKey, placeId) {
  const fieldMask = [
    'id',
    'displayName',
    'formattedAddress',
    'googleMapsUri',
    'nationalPhoneNumber',
    'rating',
    'userRatingCount',
    'regularOpeningHours',
    'reviews'
  ].join(',');

  const response = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Google Place Details failed: ${response.status} ${message}`);
  }

  return await response.json();
}

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendJson(response, 405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return sendJson(response, 503, {
      error: 'GOOGLE_MAPS_API_KEY is not configured.'
    });
  }

  try {
    const searchResult = await textSearch(apiKey);
    if (!searchResult?.id) {
      return sendJson(response, 404, { error: 'Google listing was not found.' });
    }

    const details = await placeDetails(apiKey, searchResult.id);
    const reviews = Array.isArray(details.reviews)
      ? details.reviews.slice(0, 4).map(review => ({
          author: review?.authorAttribution?.displayName || 'Google reviewer',
          text: review?.text?.text || '',
          rating: review?.rating || 0,
          relativeTimeDescription: review?.relativePublishTimeDescription || ''
        }))
      : [];

    const weekdayDescriptions = details?.regularOpeningHours?.weekdayDescriptions || [];
    const reviewWriteUrl = `https://search.google.com/local/writereview?placeid=${details.id || searchResult.id}`;

    return sendJson(response, 200, {
      placeId: details.id || searchResult.id,
      displayName: details?.displayName?.text || searchResult?.displayName?.text || 'Anything Automotive LLC',
      formattedAddress: details?.formattedAddress || searchResult?.formattedAddress || '',
      googleMapsUri: details?.googleMapsUri || '',
      nationalPhoneNumber: details?.nationalPhoneNumber || '',
      rating: details?.rating || null,
      userRatingCount: details?.userRatingCount || 0,
      weekdayDescriptions,
      reviews,
      reviewWriteUrl
    });
  } catch (error) {
    return sendJson(response, 502, {
      error: 'Failed to load Google business details.',
      details: error.message
    });
  }
};
