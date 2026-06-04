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

  // Build time window around requested time
  const fromTime = time ? time.replace(':', '') : '0000';
  const totalMins = parseInt(fromTime.slice(0,2)) * 60 + parseInt(fromTime.slice(2,4));
  const startMins = Math.max(0, totalMins - 30);
  const endMins = Math.min(1439, totalMins + 90);
  const startTime = `${String(Math.floor(startMins/60)).padStart(2,'0')}${String(startMins%60).padStart(2,'0')}`;
  const toTime = `${String(Math.floor(endMins/60)).padStart(2,'0')}${String(endMins%60).padStart(2,'0')}`;

  // Determine if weekday or weekend
  const d = new Date(date);
  const dow = d.getDay();
  const days = (dow === 0 || dow === 6) ? 'WEEKEND' : 'WEEKDAY';

  const auth = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
  const body = JSON.stringify({
    from_loc: from.toUpperCase(),
    to_loc: to.toUpperCase(),
    from_time: startTime,
    to_time: toTime,
    from_date: date,
    to_date: date,
    days
  });

  try {
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
    console.log('HSP services count:', data.Services?.length || 0);

    if (!response.ok) {
      return { statusCode: response.status, headers, body: JSON.stringify({ error: 'HSP error', detail: data }) };
    }

    // Parse HSP response — fields are in serviceAttributesMetrics
    const services = (data.Services || []).map(s => {
      const attrs = s.serviceAttributesMetrics || {};
      const metrics = (s.Metrics || [])[0] || {};

      const schedDep = attrs.gbtt_ptd; // e.g. "0944"
      const schedArr = attrs.gbtt_pta; // e.g. "1045"
      const rid = (attrs.rids || [])[0] || null;
      const toc = attrs.toc_code || null;
      const dest = attrs.destination_location || null;
      const late = parseInt(metrics.num_not_tolerance || 0) > 0;
      const cancelled = metrics.percent_tolerance === '0' && metrics.num_tolerance === '0';

      const fmt = t => t ? t.slice(0,2)+':'+t.slice(2) : null;

      return {
        scheduledDep: fmt(schedDep),
        scheduledArr: fmt(schedArr),
        actualArr: null, // fetched separately via service details
        rid,
        operator: toc,
        destination: dest,
        late,
        cancelled,
      };
    }).filter(s => s.scheduledDep);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ services })
    };

  } catch (err) {
    console.error('Error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
