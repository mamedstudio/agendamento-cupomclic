import { google } from 'googleapis';

export default async function handler(req, res) {
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
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY
      ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
      : null;

    if (!clientEmail || !privateKey) {
      return res.status(500).json({ error: 'Credenciais do Google não configuradas.' });
    }

    const auth = new google.auth.JWT(
      clientEmail,
      null,
      privateKey,
      ['https://www.googleapis.com/auth/calendar']
    );

    const calendar = google.calendar({ version: 'v3', auth });
    
    // USA A AGENDA NATIVA DO ROBÔ (Sem trava de permissão do Workspace)
    const calendarId = 'primary';

    // GET: Consulta os horários ocupados
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

    // POST: Cria o agendamento no Google Calendar
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
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      };

      const createdEvent = await calendar.events.insert({
        calendarId: calendarId,
        resource: event,
        conferenceDataVersion: 1,
      });

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
