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

  let timeOffset = 0;
  let timeWindow = 120;
  if (time && time.length === 4) {
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const reqMins = parseInt(time.slice(0,2)) * 60 + parseInt(time.slice(2,4));
    timeOffset = Math.max(-120, Math.min(120, reqMins - nowMins));
    timeWindow = 90;
  }

  // Use 2017-10-01 namespace which is confirmed working
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<SOAP-ENV:Envelope 
  xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ns1="http://thalesgroup.com/RTTI/2017-10-01/ldb/"
  xmlns:ns2="http://thalesgroup.com/RTTI/2013-11-28/Token/types">
  <SOAP-ENV:Header>
    <ns2:AccessToken>
      <ns2:TokenValue>${TOKEN}</ns2:TokenValue>
    </ns2:AccessToken>
  </SOAP-ENV:Header>
  <SOAP-ENV:Body>
    <ns1:GetDepartureBoardRequest>
      <ns1:numRows>20</ns1:numRows>
      <ns1:crs>${from.toUpperCase()}</ns1:crs>
      <ns1:filterCrs>${to.toUpperCase()}</ns1:filterCrs>
      <ns1:filterType>to</ns1:filterType>
      <ns1:timeOffset>${timeOffset}</ns1:timeOffset>
      <ns1:timeWindow>${timeWindow}</ns1:timeWindow>
    </ns1:GetDepartureBoardRequest>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  try {
    const response = await fetch('https://lite.realtime.nationalrail.co.uk/OpenLDBWS/ldb11.asmx', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'http://thalesgroup.com/RTTI/2017-10-01/ldb/GetDepartureBoard',
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
