const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let rawCreds = process.env.GOOGLE_SERVICE_ACCOUNT;
    if (!rawCreds) {
      return res.status(500).json({ error: 'GOOGLE_SERVICE_ACCOUNT não configurada.' });
    }

    const credentials = typeof rawCreds === 'string' ? JSON.parse(rawCreds) : rawCreds;
    if (credentials.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });

    const calendar = google.calendar({ version: 'v3', auth });
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

    // --- ROTA GET: Consulta horários ocupados ---
    if (req.method === 'GET') {
      const { data } = req.query;
      if (!data) return res.status(400).json({ error: 'Data não informada.' });

      const timeMin = new Date(`${data}T00:00:00-03:00`).toISOString();
      const timeMax = new Date(`${data}T23:59:59-03:00`).toISOString();

      const eventsResponse = await calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const ocupados = eventsResponse.data.items.map(event => {
        const start = event.start.dateTime || event.start.date;
        return new Date(start).toLocaleTimeString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          minute: '2-digit',
        });
      });

      return res.status(200).json({ ocupados });
    }

    // --- ROTA POST: Criar a reunião no Google Meet ---
    if (req.method === 'POST') {
      const { data, hora, nome, email, funcao, loja, whatsapp } = req.body;

      if (!data || !hora || !nome || !email || !loja) {
        return res.status(400).json({ error: 'Dados incompletos.' });
      }

      const startIso = `${data}T${hora}:00-03:00`;
      const startDate = new Date(startIso);
      const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);

      const event = {
        summary: `Reunião VIP CupomClic - ${loja}`,
        description: `📌 Detalhes do Agendamento VIP\n• Loja: ${loja}\n• Responsável: ${nome} (${funcao})\n• E-mail: ${email}\n• WhatsApp: ${whatsapp}`,
        start: {
          dateTime: startDate.toISOString(),
          timeZone: 'America/Sao_Paulo',
        },
        end: {
          dateTime: endDate.toISOString(),
          timeZone: 'America/Sao_Paulo',
        },
        conferenceData: {
          createRequest: {
            requestId: `meet-${Date.now()}`,
            conferenceSolutionKey: { type: 'addOn' },
          },
        },
      };

      const response = await calendar.events.insert({
        calendarId,
        requestBody: event,
        conferenceDataVersion: 1,
      });

      const meetLink = response.data.hangoutLink || response.data.htmlLink;

      return res.status(200).json({
        success: true,
        meetLink,
        eventId: response.data.id,
      });
    }

    return res.status(405).json({ error: 'Método não permitido.' });

  } catch (error) {
    console.error('Erro na API Calendar:', error);
    return res.status(500).json({ 
      error: 'Erro ao criar evento.', 
      details: error.message || error.toString() 
    });
  }
};
