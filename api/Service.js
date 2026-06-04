exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { rid, toCRS } = event.queryStringParameters || {};

  if (!rid) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing rid' }) };
  }

  const USERNAME = process.env.NRE_USERNAME;
  const PASSWORD = process.env.NRE_PASSWORD;

  if (!USERNAME || !PASSWORD) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'NRE credentials not configured' }) };
  }

  try {
    const auth = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
    const response = await fetch('https://hsp-prod.rockshore.net/api/v1/serviceDetails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body: JSON.stringify({ rid }),
    });

    const data = await response.json();
    console.log('HSP service status:', response.status);
    console.log('HSP service data:', JSON.stringify(data).slice(0, 500));

    if (!response.ok) {
      return { statusCode: response.status, headers, body: JSON.stringify({ error: 'HSP error', detail: data }) };
    }

    const fmt = t => t ? t.slice(0,2)+':'+t.slice(2) : null;
    const locations = data.serviceAttributesDetails?.locations || [];

    const stops = locations.map(loc => ({
      crs: loc.location,
      scheduledArr: fmt(loc.gbtt_pta),
      scheduledDep: fmt(loc.gbtt_ptd),
      actualArr: fmt(loc.actual_ta),
      actualDep: fmt(loc.actual_td),
    }));

    // Find destination stop
    const destStop = toCRS
      ? stops.find(s => s.crs === toCRS.toUpperCase()) || stops[stops.length - 1]
      : stops[stops.length - 1];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ stops, destStop })
    };

  } catch (err) {
    console.error('Error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
