const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const qrcode = require('qrcode-terminal')
const pino = require('pino')
const fs = require('fs')
const path = require('path')

const torneo = require('./torneo')
const imagen = require('./imagen')

// ─── CONFIGURACIÓN ───────────────────────────────────────────────────────────
const GRUPO_NOMBRE = "Prueba Bot Torneo"  // nombre exacto del grupo
let GRUPO_ID = null  // se detecta automáticamente

// ─── BOT ─────────────────────────────────────────────────────────────────────

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info')
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
    })

    // ── QR para conectar ──────────────────────────────────────────────────
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            console.log('\n📱 Escanea este QR con WhatsApp Business (el número Marcador):\n')
            qrcode.generate(qr, { small: true })
            console.log('\nAbre WhatsApp Business → Dispositivos vinculados → Vincular dispositivo\n')
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
            console.log('Conexión cerrada. Reconectando:', shouldReconnect)
            if (shouldReconnect) {
                setTimeout(iniciarBot, 3000)
            }
        }

        if (connection === 'open') {
            console.log('✅ Bot conectado a WhatsApp')
            await detectarGrupo(sock)
        }
    })

    sock.ev.on('creds.update', saveCreds)

    // ── Recibir mensajes ──────────────────────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return

        for (const msg of messages) {
            if (msg.key.fromMe) continue
            if (!msg.message) continue

            const chat_id = msg.key.remoteJid

            // Solo procesar mensajes del grupo del torneo
            if (GRUPO_ID && chat_id !== GRUPO_ID) continue

            const texto = msg.message?.conversation
                || msg.message?.extendedTextMessage?.text
                || ''

            if (!texto.trim()) continue

            const numero_from = msg.key.participant || msg.key.remoteJid
            const numero_limpio = numero_from.replace('@s.whatsapp.net', '').replace('@lid', '')

            // Menciones
            const menciones_nums = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []

            console.log(`[MSG] ${numero_limpio}: '${texto.substring(0, 80)}'`)

            await procesarMensaje(sock, chat_id, texto, numero_limpio, menciones_nums)
        }
    })

    // ── Detectar nuevos grupos ────────────────────────────────────────────
    sock.ev.on('groups.update', async () => {
        await detectarGrupo(sock)
    })

    return sock
}

// ─── DETECTAR GRUPO POR NOMBRE ───────────────────────────────────────────────

async function detectarGrupo(sock) {
    try {
        const grupos = await sock.groupFetchAllParticipating()
        for (const [id, info] of Object.entries(grupos)) {
            if (info.subject === GRUPO_NOMBRE) {
                GRUPO_ID = id
                console.log(`✅ Grupo encontrado: "${GRUPO_NOMBRE}" → ${GRUPO_ID}`)
                return
            }
        }
        console.log(`⚠️  Grupo "${GRUPO_NOMBRE}" no encontrado. Grupos disponibles:`)
        for (const [id, info] of Object.entries(grupos)) {
            console.log(`   - "${info.subject}" (${id})`)
        }
    } catch (e) {
        console.log('[detectarGrupo ERROR]', e.message)
    }
}

// ─── ENVIAR TEXTO ─────────────────────────────────────────────────────────────

async function enviarMensaje(sock, chat_id, texto) {
    try {
        await sock.sendMessage(chat_id, { text: texto })
    } catch (e) {
        console.log('[enviarMensaje ERROR]', e.message)
    }
}

// ─── ENVIAR IMAGEN ────────────────────────────────────────────────────────────

async function enviarImagen(sock, chat_id, imagen_buffer, caption = '') {
    try {
        await sock.sendMessage(chat_id, {
            image: imagen_buffer,
            caption: caption
        })
    } catch (e) {
        console.log('[enviarImagen ERROR]', e.message)
    }
}

// ─── PROCESAR MENSAJE ─────────────────────────────────────────────────────────

async function procesarMensaje(sock, chat_id, texto, numero_from, menciones_nums) {
    const texto_lower = texto.toLowerCase().trim()

    // ── Comandos ──────────────────────────────────────────────────────────
    if (texto_lower === 'tabla' || texto_lower === 'posiciones') {
        const img = await imagen.generarTabla(torneo.getDB())
        await enviarImagen(sock, chat_id, img, '📊 Tabla del torneo')
        return
    }

    if (texto_lower.startsWith('tabla ')) {
        const gn = texto.substring(6).trim()
        const gn_title = gn.charAt(0).toUpperCase() + gn.slice(1).toLowerCase()
        const db = torneo.getDB()
        if (db.grupos[gn_title]) {
            const img = await imagen.generarTabla(db, gn_title)
            await enviarImagen(sock, chat_id, img, `📊 ${gn_title}`)
        } else {
            await enviarMensaje(sock, chat_id, `❌ Grupo '${gn_title}' no encontrado.`)
        }
        return
    }

    if (texto_lower === 'ayuda' || texto_lower === '/ayuda' || texto_lower === 'help') {
        await enviarMensaje(sock, chat_id,
            '🎾 *Cómo reportar un resultado:*\n\n' +
            '✅ *Ganaste:*\n@Marcador le gané a @Rival 6-4 6-2\n\n' +
            '❌ *Perdiste:*\n@Marcador perdí con @Rival 6-4 6-2\n\n' +
            '🚶 *Default o Walkover:*\n@Javier gana a @German por default\n@German pierde con @Javier por walkover\n\n' +
            '*Puntos:*\n' +
            '• Victoria → +3 pts\n' +
            '• Derrota → +1 pt\n' +
            '• Walkover/Default (ganador) → +3 pts\n' +
            '• Walkover/Default (perdedor) → -1 pt\n' +
            '• No reportado al fin de mes → -1 pt (ambos)\n\n' +
            '*Comandos:*\n' +
            '• *tabla* — ver posiciones\n' +
            '• *partidos* — ver resultados\n' +
            '• *ayuda* — este menú'
        )
        return
    }

    if (texto_lower === 'partidos' || texto_lower === '/partidos') {
        const db = torneo.getDB()
        const partidos_reales = db.partidos.filter(p => p.tipo !== 'no_reportado')
        if (!partidos_reales.length) {
            await enviarMensaje(sock, chat_id, '📋 No hay partidos registrados aún.')
        } else {
            const lineas = ['📋 *Últimos partidos:*']
            partidos_reales.slice(-10).reverse().forEach(p => {
                const icono = p.tipo === 'walkover' ? '🚶' : p.tipo === 'default' ? '🚫' : '🎾'
                lineas.push(`${icono} ${p.grupo}: ${p.ganador} d. ${p.perdedor} (${p.sets}) — ${p.fecha.substring(0, 10)}`)
            })
            await enviarMensaje(sock, chat_id, lineas.join('\n'))
        }
        return
    }

    // ── Resultado ─────────────────────────────────────────────────────────
    if (torneo.esMensajeTorneo(texto, menciones_nums)) {
        const r = torneo.parsearMensaje(texto, numero_from, menciones_nums)

        if (r.error) {
            await enviarMensaje(sock, chat_id, r.error)
            return
        }

        let ganador_n, perdedor_n
        if (r.modo === 'directo') {
            ganador_n  = r.ganador_directo.nombre
            perdedor_n = r.perdedor_directo.nombre
        } else {
            ganador_n  = r.gano_remitente ? r.remitente.nombre : r.rival.nombre
            perdedor_n = r.gano_remitente ? r.rival.nombre     : r.remitente.nombre
        }

        const { ok, msg } = torneo.registrarResultado(ganador_n, perdedor_n, r.sets_str, r.remitente.nombre, r.tipo)
        await enviarMensaje(sock, chat_id, msg)

        if (ok) {
            const img = await imagen.generarTabla(torneo.getDB())
            await enviarImagen(sock, chat_id, img)
        }
    }
}

// ─── ARRANCAR ─────────────────────────────────────────────────────────────────

console.log('🎾 Iniciando Bot Torneo de Tenis...')
iniciarBot().catch(console.error)
