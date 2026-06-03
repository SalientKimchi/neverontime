// Netlify function — Darwin LDB service details
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { serviceID, toCRS } = event.queryStringParameters || {};
  if (!serviceID) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing serviceID' }) };
  }

  const TOKEN = process.env.DARWIN_TOKEN;
  if (!TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Token not configured' }) };
  }

  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:typ="http://thalesgroup.com/RTTI/2013-11-28/Token/types"
  xmlns:ldb="http://thalesgroup.com/RTTI/2021-11-01/ldb/">
  <soap:Header>
    <typ:AccessToken>
      <typ:TokenValue>${TOKEN}</typ:TokenValue>
    </typ:AccessToken>
  </soap:Header>
  <soap:Body>
    <ldb:GetServiceDetailsRequest>
      <ldb:serviceID>${serviceID}</ldb:serviceID>
    </ldb:GetServiceDetailsRequest>
  </soap:Body>
</soap:Envelope>`;

  try {
    const response = await fetch('https://lite.realtime.nationalrail.co.uk/OpenLDBWS/ldb11.asmx', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'http://thalesgroup.com/RTTI/2021-11-01/ldb/GetServiceDetails',
      },
      body: soapBody,
    });

    const xml = await response.text();

    // Parse calling points
    const stops = [];
    const regex = /<(?:\w+:)?callingPoint\b[^>]*>([\s\S]*?)<\/(?:\w+:)?callingPoint>/g;
    let match;

    while ((match = regex.exec(xml)) !== null) {
      const block = match[1];
      const get = (tag) => {
        const m = block.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>(.*?)<\\/(?:\\w+:)?${tag}>`));
        return m ? m[1].trim() : null;
      };
      const crs = get('crs');
      const locationName = get('locationName');
      const st = get('st');
      const et = get('et');
      const at = get('at');
      if (crs) stops.push({ crs, locationName, scheduledArr: st, estimatedArr: et, actualArr: at });
    }

    // Find destination stop
    const destStop = toCRS
      ? stops.find(s => s.crs === toCRS.toUpperCase()) || stops[stops.length - 1]
      : stops[stops.length - 1];

    return { statusCode: 200, headers, body: JSON.stringify({ stops, destStop: destStop || null }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
