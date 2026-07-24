import { google } from 'googleapis';

export default async function handler(req, res) {
  // Configuração de CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    let clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    let privateKey = process.env.GOOGLE_PRIVATE_KEY;

    if (process.env.GOOGLE_SERVICE_ACCOUNT) {
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
      clientEmail = credentials.client_email;
      privateKey = credentials.private_key;
    }

    if (privateKey) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    if (!clientEmail || !privateKey) {
      return res.status(500).json({ error: 'Credenciais do Google não encontradas na Vercel.' });
    }

    const auth = new google.auth.JWT(
      clientEmail,
      null,
      privateKey,
      ['https://www.googleapis.com/auth/calendar']
    );

    const calendar = google.calendar({ version: 'v3', auth });

    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

    // ----------------------------------------------------
    // METODO GET: Consulta os agendamentos do dia
    // ----------------------------------------------------
    if (req.method === 'GET') {
      const { data } = req.query;

      if (!data) {
        return res.status(400).json({ error: 'Data não informada.' });
      }

      const timeMin = `${data}T00:00:00-03:00`;
      const timeMax = `${data}T23:59:59-03:00`;

      const response = await calendar.events.list({
        calendarId: calendarId,
        timeMin: timeMin,
        timeMax: timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = response.data.items || [];

      const ocupados = events.map(event => {
        if (event.start && event.start.dateTime) {
          const date = new Date(event.start.dateTime);
          const horas = String(date.getHours()).padStart(2, '0');
          const minutos = String(date.getMinutes()).padStart(2, '0');
          return `${horas}:${minutos}`;
        }
        return null;
      }).filter(Boolean);

      return res.status(200).json({ ocupados });
    }

    // ----------------------------------------------------
    // METODO POST: Cria o agendamento no Google Calendar
    // ----------------------------------------------------
    if (req.method === 'POST') {
      const { data, hora, nome, email, funcao, loja, whatsapp } = req.body;

      if (!data || !hora || !nome || !loja || !whatsapp) {
        return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
      }

      const startDateTime = `${data}T${hora}:00-03:00`;
      
      const [h, m] = hora.split(':').map(Number);
      let endH = h;
      let endM = m + 30;
      if (endM >= 60) {
        endH += 1;
        endM -= 60;
      }
      const endHStr = String(endH).padStart(2, '0');
      const endMStr = String(endM).padStart(2, '0');
      const endDateTime = `${data}T${endHStr}:${endMStr}:00-03:00`;

      const event = {
        summary: `Reunião VIP CupomClic - ${loja} (${nome})`,
        description: `Agendamento via Site CupomClic\n\nNome: ${nome}\nE-mail: ${email}\nFunção: ${funcao}\nLoja: ${loja}\nWhatsApp: ${whatsapp}`,
        start: {
          dateTime: startDateTime,
          timeZone: 'America/Sao_Paulo',
        },
        end: {
          dateTime: endDateTime,
          timeZone: 'America/Sao_Paulo',
        },
        conferenceData: {
          createRequest: {
            requestId: `cupomclic-${Date.now()}`,
            conferenceSolutionKey: { type: 'eventHangout' },
          },
        },
      };

      const createdEvent = await calendar.events.insert({
        calendarId: calendarId,
        resource: event,
        conferenceDataVersion: 1,
      });

      // Pega o link do Meet gerado ou o link direto do evento no Calendar
      const meetLink = createdEvent.data.hangoutLink || createdEvent.data.htmlLink;

      return res.status(200).json({
        success: true,
        eventId: createdEvent.data.id,
        meetLink: meetLink,
      });
    }

    return res.status(405).json({ error: 'Método não permitido.' });

  } catch (error) {
    console.error('Erro na API:', error);
    return res.status(500).json({
      error: 'Erro interno no servidor de agendamento.',
      details: error.message,
    });
  }
}
