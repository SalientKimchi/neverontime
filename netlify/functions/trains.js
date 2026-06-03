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
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing from/to' }) };
  }

  const TOKEN = process.env.DARWIN_TOKEN;
  if (!TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Token not configured' }) };
  }

  // Calculate time offset from now
  let timeOffset = 0;
  let timeWindow = 120;
  if (time && time.length === 4) {
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const reqMins = parseInt(time.slice(0,2)) * 60 + parseInt(time.slice(2,4));
    timeOffset = Math.max(-120, Math.min(120, reqMins - nowMins));
    timeWindow = 90;
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
    <ldb:GetDepartureBoardRequest>
      <ldb:numRows>20</ldb:numRows>
      <ldb:crs>${from.toUpperCase()}</ldb:crs>
      <ldb:filterCrs>${to.toUpperCase()}</ldb:filterCrs>
      <ldb:filterType>to</ldb:filterType>
      <ldb:timeOffset>${timeOffset}</ldb:timeOffset>
      <ldb:timeWindow>${timeWindow}</ldb:timeWindow>
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
    console.log('Darwin status:', response.status);
    console.log('Darwin XML:', xml.slice(0, 800));

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
      const isCancelled = /isCancelled="true"/.test(block);
      const destMatch = block.match(/<(?:\w+:)?destination[^>]*>[\s\S]*?<(?:\w+:)?locationName>(.*?)<\/(?:\w+:)?locationName>/);
      const destination = destMatch ? destMatch[1] : to.toUpperCase();

      if (scheduledDep) {
        services.push({ scheduledDep, estimatedDep: estimatedDep || 'On time', platform, operator, serviceID, destination, cancelled: isCancelled });
      }
    }

    return { 
      statusCode: 200, 
      headers, 
      body: JSON.stringify({ 
        services, 
        timeOffset,
        debug: services.length === 0 ? xml.slice(0, 1200) : null 
      }) 
    };

  } catch (err) {
    console.error('Error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
