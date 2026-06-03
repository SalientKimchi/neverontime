// Netlify function — Darwin LDB proxy
// Darwin LDB SOAP API v2021-11-01
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { from, to } = event.queryStringParameters || {};

  if (!from || !to) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing from/to' }) };
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
    <ldb:GetDepBoardWithDetailsRequest>
      <ldb:numRows>20</ldb:numRows>
      <ldb:crs>${from.toUpperCase()}</ldb:crs>
      <ldb:filterCrs>${to.toUpperCase()}</ldb:filterCrs>
      <ldb:filterType>to</ldb:filterType>
      <ldb:timeOffset>-120</ldb:timeOffset>
      <ldb:timeWindow>240</ldb:timeWindow>
    </ldb:GetDepBoardWithDetailsRequest>
  </soap:Body>
</soap:Envelope>`;

  try {
    const response = await fetch('https://lite.realtime.nationalrail.co.uk/OpenLDBWS/ldb11.asmx', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'http://thalesgroup.com/RTTI/2021-11-01/ldb/GetDepBoardWithDetails',
      },
      body: soapBody,
    });

    const xml = await response.text();

    if (!response.ok) {
      return { statusCode: response.status, headers, body: JSON.stringify({ error: 'Darwin error', xml: xml.slice(0, 500) }) };
    }

    // Parse services
    const services = [];
    const regex = /<(?:\w+:)?service\b[^>]*>([\s\S]*?)<\/(?:\w+:)?service>/g;
    let match;

    while ((match = regex.exec(xml)) !== null) {
      const block = match[1];
      const get = (tag) => {
        const m = block.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>(.*?)<\\/(?:\\w+:)?${tag}>`, 's'));
        return m ? m[1].trim() : null;
      };

      const scheduledDep = get('std');
      const estimatedDep = get('etd');
      const platform = get('platform');
      const operator = get('operator');
      const serviceID = get('serviceID');
      const isCancelled = /isCancelled="true"/.test(block) || /isCircularRoute/.test(block) && get('etd') === 'Cancelled';

      // Get destination name
      const destMatch = block.match(/<(?:\w+:)?destination[^>]*>[\s\S]*?<(?:\w+:)?locationName>(.*?)<\/(?:\w+:)?locationName>/);
      const destination = destMatch ? destMatch[1] : to.toUpperCase();

      if (scheduledDep) {
        services.push({ scheduledDep, estimatedDep: estimatedDep || 'On time', platform, operator, serviceID, destination, cancelled: isCancelled });
      }
    }

    // If no services parsed, return raw snippet for debugging
    if (!services.length) {
      const snippet = xml.slice(0, 1000);
      return { statusCode: 200, headers, body: JSON.stringify({ services: [], debug: snippet }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ services }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
