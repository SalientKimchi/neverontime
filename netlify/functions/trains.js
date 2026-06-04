// HSP API proxy — Historical Service Performance
// REST JSON, uses NRDP username/password
// Docs: https://hsp-prod.rockshore.net/
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { from, to, date, time } = event.queryStringParameters || {};

  if (!from || !to || !date) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing from, to, or date' }) };
  }

  const USERNAME = process.env.NRE_USERNAME;
  const PASSWORD = process.env.NRE_PASSWORD;

  if (!USERNAME || !PASSWORD) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'NRE credentials not configured' }) };
  }

  // HSP date format: YYYY-MM-DD
  // Time window: 30 mins either side of requested time
  const fromTime = time ? time.replace(':', '') : '0000';
  const fromHour = parseInt(fromTime.slice(0,2));
  const fromMin = parseInt(fromTime.slice(2,4));
  const totalMins = fromHour * 60 + fromMin;
  const startMins = Math.max(0, totalMins - 30);
  const endMins = Math.min(1439, totalMins + 60);
  const toTime = `${String(Math.floor(endMins/60)).padStart(2,'0')}${String(endMins%60).padStart(2,'0')}`;
  const startTime = `${String(Math.floor(startMins/60)).padStart(2,'0')}${String(startMins%60).padStart(2,'0')}`;

  const body = JSON.stringify({
    from_loc: from.toUpperCase(),
    to_loc: to.toUpperCase(),
    from_time: startTime,
    to_time: toTime,
    from_date: date,
    to_date: date,
    days: 'WEEKDAY' // will try both
  });

  try {
    const auth = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
    const response = await fetch('https://hsp-prod.rockshore.net/api/v1/serviceMetrics', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body,
    });

    const data = await response.json();
    console.log('HSP status:', response.status);
    console.log('HSP response:', JSON.stringify(data).slice(0, 500));

    if (!response.ok) {
      // Try with WEEKEND if WEEKDAY fails
      const body2 = JSON.stringify({
        from_loc: from.toUpperCase(),
        to_loc: to.toUpperCase(),
        from_time: startTime,
        to_time: toTime,
        from_date: date,
        to_date: date,
        days: 'WEEKEND'
      });
      const r2 = await fetch('https://hsp-prod.rockshore.net/api/v1/serviceMetrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
        body: body2,
      });
      const d2 = await r2.json();
      if (!r2.ok) {
        return { statusCode: response.status, headers, body: JSON.stringify({ error: 'HSP error', detail: data }) };
      }
      return processHSPResponse(d2, headers);
    }

    return processHSPResponse(data, headers);

  } catch (err) {
    console.error('Error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

function processHSPResponse(data, headers) {
  const services = (data.Services || []).map(s => {
    const metrics = s.Metrics || {};
    const scheduledDep = metrics.scheduled_departure || null;
    const scheduledArr = metrics.scheduled_arrival || null;
    const actualArr = metrics.actual_arrival || null;
    const cancelled = metrics.CancelledEnRoute || metrics.CancelledAtOrigin || false;
    const late = metrics.num_not_on_time > 0;

    return {
      scheduledDep: scheduledDep ? scheduledDep.slice(0,2)+':'+scheduledDep.slice(2) : null,
      scheduledArr: scheduledArr ? scheduledArr.slice(0,2)+':'+scheduledArr.slice(2) : null,
      actualArr: actualArr ? actualArr.slice(0,2)+':'+actualArr.slice(2) : null,
      cancelled,
      late,
      serviceID: s.serviceAttributesMetrics?.rid || null,
      operator: s.serviceAttributesMetrics?.toc_code || null,
    };
  }).filter(s => s.scheduledDep);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ services })
  };
}
