// Netlify function — Darwin LDB service details (arrival times at destination)
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { serviceID } = event.queryStringParameters || {};

  if (!serviceID) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing serviceID' }) };
  }

  const TOKEN = process.env.DARWIN_TOKEN;
  if (!TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Darwin token not configured' }) };
  }

  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:typ="http://thalesgroup.com/RTTI/2013-11-28/Token/types" xmlns:ldb="http://thalesgroup.com/RTTI/2021-11-01/ldb/">
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

    // Find all calling points
    const stops = [];
    const stopMatches = xml.matchAll(/<lt\d+:callingPoint>([\s\S]*?)<\/lt\d+:callingPoint>/g);

    for (const match of stopMatches) {
      const block = match[1];
      const crs = (block.match(/<lt\d+:crs>(.*?)<\/lt\d+:crs>/) || [])[1];
      const locationName = (block.match(/<lt\d+:locationName>(.*?)<\/lt\d+:locationName>/) || [])[1];
      const st = (block.match(/<lt\d+:st>(.*?)<\/lt\d+:st>/) || [])[1]; // scheduled time
      const et = (block.match(/<lt\d+:et>(.*?)<\/lt\d+:et>/) || [])[1]; // estimated time
      const at = (block.match(/<lt\d+:at>(.*?)<\/lt\d+:at>/) || [])[1]; // actual time
      if (crs) stops.push({ crs, locationName, scheduledArr: st, estimatedArr: et, actualArr: at });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ stops })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Darwin API error', detail: err.message })
    };
  }
};
