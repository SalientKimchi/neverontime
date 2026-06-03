// Netlify function — Darwin LDB proxy for departures
// Uses National Rail Live Departure Boards SOAP API
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { from, to, time } = event.queryStringParameters || {};

  if (!from || !to) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing from/to parameters' }) };
  }

  const TOKEN = process.env.DARWIN_TOKEN;
  if (!TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Darwin token not configured' }) };
  }

  // Darwin LDB SOAP request for departures from station filtered to destination
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:typ="http://thalesgroup.com/RTTI/2013-11-28/Token/types" xmlns:ldb="http://thalesgroup.com/RTTI/2021-11-01/ldb/">
  <soap:Header>
    <typ:AccessToken>
      <typ:TokenValue>${TOKEN}</typ:TokenValue>
    </typ:AccessToken>
  </soap:Header>
  <soap:Body>
    <ldb:GetDepartureBoardRequest>
      <ldb:numRows>20</ldb:numRows>
      <ldb:crs>${from.toUpperCase()}</ldb:crs>
      <ldb:filterCrs>${to.toUpperCase()}</ldb:filterCrs>
      <ldb:filterType>to</ldb:filterType>
      <ldb:timeOffset>-120</ldb:timeOffset>
      <ldb:timeWindow>240</ldb:timeWindow>
    </ldb:GetDepartureBoardRequest>
  </soap:Body>
</soap:Envelope>`;

  try {
    const response = await fetch('https://lite.realtime.nationalrail.co.uk/OpenLDBWS/ldb11.asmx', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'http://thalesgroup.com/RTTI/2021-11-01/ldb/GetDepartureBoard',
      },
      body: soapBody,
    });

    const xml = await response.text();

    // Parse services from XML
    const services = [];
    const serviceMatches = xml.matchAll(/<lt\d+:service>([\s\S]*?)<\/lt\d+:service>/g);

    for (const match of serviceMatches) {
      const block = match[1];
      const scheduledDep = (block.match(/<lt\d+:std>(.*?)<\/lt\d+:std>/) || [])[1];
      const estimatedDep = (block.match(/<lt\d+:etd>(.*?)<\/lt\d+:etd>/) || [])[1];
      const platform = (block.match(/<lt\d+:platform>(.*?)<\/lt\d+:platform>/) || [])[1];
      const operator = (block.match(/<lt\d+:operator>(.*?)<\/lt\d+:operator>/) || [])[1];
      const serviceID = (block.match(/<lt\d+:serviceID>(.*?)<\/lt\d+:serviceID>/) || [])[1];
      const isCancelled = block.includes('<lt') && block.includes('isCancelled="true"');

      // Get destination
      const destMatch = block.match(/<lt\d+:destination>[\s\S]*?<lt\d+:locationName>(.*?)<\/lt\d+:locationName>/);
      const destination = destMatch ? destMatch[1] : to;

      if (scheduledDep) {
        services.push({
          scheduledDep,
          estimatedDep: estimatedDep || 'On time',
          platform: platform || null,
          operator: operator || null,
          serviceID: serviceID || null,
          destination,
          cancelled: isCancelled,
        });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ services })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Darwin API error', detail: err.message })
    };
  }
};
