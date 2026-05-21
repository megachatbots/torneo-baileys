const fs = require('fs')

const DB_FILE        = 'torneo_data.json'
const JUGADORES_FILE = 'jugadores.json'

const PTS_VICTORIA = 3
const PTS_DERROTA  = 1
const PTS_WALKOVER = 3
const PTS_DEFAULT  = -1
const PTS_NO_REP   = -1

// ─── JUGADORES ───────────────────────────────────────────────────────────────

function cargarJugadores() {
    if (fs.existsSync(JUGADORES_FILE)) {
        return JSON.parse(fs.readFileSync(JUGADORES_FILE, 'utf8'))
    }
    // Piloto por defecto
    const piloto = {
        "5215543580988": { nombre: "German",  grupo: "Grupo A" },
        "5216621027164": { nombre: "Javier",  grupo: "Grupo A" },
        "5215549090743": { nombre: "Antonio", grupo: "Grupo A" },
        "5215514510677": { nombre: "Marco",   grupo: "Grupo B" },
        "5215540882735": { nombre: "Ricardo", grupo: "Grupo B" },
        "5215531654937": { nombre: "Jerry",   grupo: "Grupo B" },
    }
    fs.writeFileSync(JUGADORES_FILE, JSON.stringify(piloto, null, 2))
    return piloto
}

let jugadores_db = cargarJugadores()

function numeroAJugador(numero) {
    const limpio = numero.replace(/\D/g, '')
    for (const [tel, data] of Object.entries(jugadores_db)) {
        const tel_limpio = tel.replace(/\D/g, '')
        if (limpio === tel_limpio || limpio.endsWith(tel_limpio) || tel_limpio.endsWith(limpio)) {
            return { telefono: tel, ...data }
        }
    }
    return null
}

function nombreAJugador(nombre) {
    const nl = nombre.toLowerCase().trim()
    for (const [tel, data] of Object.entries(jugadores_db)) {
        if (data.nombre.toLowerCase() === nl) return { telefono: tel, ...data }
    }
    return null
}

// ─── BASE DE DATOS ───────────────────────────────────────────────────────────

function statsVacio() {
    return { pj:0, pg:0, pp:0, sets_f:0, sets_c:0, juegos_f:0, juegos_c:0, pts:0, walkovers:0, defaults:0 }
}

function initTorneo() {
    const nivel_map = { "Grupo A":1, "Grupo B":2, "Grupo C":3 }
    const grupos = {}
    for (const [tel, data] of Object.entries(jugadores_db)) {
        const g = data.grupo
        if (!grupos[g]) grupos[g] = { nivel: nivel_map[g] || Object.keys(grupos).length+1, jugadores: {} }
        grupos[g].jugadores[data.nombre] = statsVacio()
    }
    return {
        nombre: "Torneo Tenis Prueba",
        modo: "piloto",
        temporada: "2024-T1",
        grupos,
        partidos: [],
        conflictos: [],
        log: []
    }
}

function cargarDB() {
    if (fs.existsSync(DB_FILE)) {
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
    }
    return initTorneo()
}

function guardarDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2))
}

let db = cargarDB()

function getDB() { return db }

// ─── TABLA ORDENADA ──────────────────────────────────────────────────────────

function tablaOrdenada(grupo_nombre) {
    const gd = db.grupos[grupo_nombre]
    const partidos_grupo = db.partidos.filter(p => p.grupo === grupo_nombre)
    let jugadores = Object.entries(gd.jugadores)

    jugadores.sort((a, b) => {
        const sa = a[1], sb = b[1]
        if (sb.pts !== sa.pts) return sb.pts - sa.pts
        const dif_a = sa.sets_f - sa.sets_c
        const dif_b = sb.sets_f - sb.sets_c
        if (dif_b !== dif_a) return dif_b - dif_a
        return (sb.juegos_f - sb.juegos_c) - (sa.juegos_f - sa.juegos_c)
    })

    // Desempate directo entre 2 con mismo puntaje
    for (let i = 0; i < jugadores.length - 1; i++) {
        for (let j = i+1; j < jugadores.length; j++) {
            const [ni, si] = jugadores[i]
            const [nj, sj] = jugadores[j]
            if (si.pts === sj.pts) {
                const partido = partidos_grupo.find(p =>
                    new Set([p.ganador, p.perdedor]).size === 2 &&
                    p.ganador === nj || p.perdedor === ni && p.ganador === nj
                )
                if (partido && partido.ganador === nj) {
                    [jugadores[i], jugadores[j]] = [jugadores[j], jugadores[i]]
                }
            }
        }
    }
    return jugadores
}

// ─── PARSEAR SETS ────────────────────────────────────────────────────────────

function parsearSets(sets_str) {
    let sg=0, sp=0, jg=0, jp=0
    const sets = sets_str.trim().split(/\s+/)
    for (const s of sets) {
        const partes = s.replace('–','-').split('-')
        if (partes.length === 2) {
            const a = parseInt(partes[0]), b = parseInt(partes[1])
            if (!isNaN(a) && !isNaN(b)) {
                a > b ? sg++ : sp++
                jg += a; jp += b
            }
        }
    }
    return { sg, sp, jg, jp }
}

// ─── REGISTRAR RESULTADO ─────────────────────────────────────────────────────

function registrarResultado(ganador_n, perdedor_n, sets_str, reportado_por='', tipo='jugado') {
    // Buscar grupo
    let grupo_nombre = null
    for (const [gn, gd] of Object.entries(db.grupos)) {
        if (gd.jugadores[ganador_n] && gd.jugadores[perdedor_n]) {
            grupo_nombre = gn; break
        }
    }
    if (!grupo_nombre) return { ok: false, msg: `❌ ${ganador_n} y ${perdedor_n} no están en el mismo grupo.` }

    // Verificar duplicado
    const existente = db.partidos.find(p =>
        new Set([p.ganador, p.perdedor]).size === 2 &&
        ((p.ganador === ganador_n && p.perdedor === perdedor_n) ||
         (p.ganador === perdedor_n && p.perdedor === ganador_n)) &&
        p.grupo === grupo_nombre
    )
    if (existente) return {
        ok: false,
        msg: `⚠️ Ya existe un resultado para *${ganador_n} vs ${perdedor_n}*.\nPrevio: ${existente.ganador} venció a ${existente.perdedor} (${existente.sets})\nSi hay error contacta al administrador.`
    }

    const g = db.grupos[grupo_nombre].jugadores
    let emoji, detalle

    if (tipo === 'jugado') {
        const { sg, sp, jg, jp } = parsearSets(sets_str)
        g[ganador_n].pj++;  g[ganador_n].pg++
        g[ganador_n].sets_f += sg; g[ganador_n].sets_c += sp
        g[ganador_n].juegos_f += jg; g[ganador_n].juegos_c += jp
        g[ganador_n].pts += PTS_VICTORIA
        g[perdedor_n].pj++; g[perdedor_n].pp++
        g[perdedor_n].sets_f += sp; g[perdedor_n].sets_c += sg
        g[perdedor_n].juegos_f += jp; g[perdedor_n].juegos_c += jg
        g[perdedor_n].pts += PTS_DERROTA
        emoji = '🎾'; detalle = sets_str
    } else {
        g[ganador_n].pg++;  g[ganador_n].walkovers++
        g[ganador_n].pts += PTS_WALKOVER
        g[perdedor_n].pp++; g[perdedor_n].defaults++
        g[perdedor_n].pts += PTS_DEFAULT
        sets_str = tipo === 'walkover' ? 'W.O.' : 'DEF'
        emoji = tipo === 'walkover' ? '🚶' : '🚫'
        detalle = tipo === 'walkover' ? 'Walk Over' : 'Default'
    }

    db.partidos.push({
        grupo: grupo_nombre, ganador: ganador_n, perdedor: perdedor_n,
        sets: sets_str, tipo, fecha: new Date().toISOString(), reportado_por
    })
    guardarDB(db)

    const msg = (
        `${emoji} *Resultado registrado — ${grupo_nombre}*\n` +
        `🏆 *${ganador_n}* venció a *${perdedor_n}* (${detalle})\n` +
        `_(Reportado por ${reportado_por})_`
    )
    return { ok: true, msg }
}

// ─── APLICAR NO REPORTADOS ───────────────────────────────────────────────────

function aplicarNoReportados() {
    const penalizados = []
    for (const [gn, gd] of Object.entries(db.grupos)) {
        const nombres = Object.keys(gd.jugadores)
        for (let i = 0; i < nombres.length; i++) {
            for (let j = i+1; j < nombres.length; j++) {
                const j1 = nombres[i], j2 = nombres[j]
                const jugado = db.partidos.some(p =>
                    p.grupo === gn && p.tipo !== 'no_reportado' &&
                    ((p.ganador === j1 && p.perdedor === j2) || (p.ganador === j2 && p.perdedor === j1))
                )
                if (!jugado) {
                    gd.jugadores[j1].pts += PTS_NO_REP
                    gd.jugadores[j2].pts += PTS_NO_REP
                    penalizados.push(`${j1} vs ${j2} (${gn})`)
                    db.partidos.push({
                        grupo: gn, ganador: '—', perdedor: '—', sets: 'NR',
                        tipo: 'no_reportado', jugadores: [j1, j2],
                        fecha: new Date().toISOString(), reportado_por: 'Sistema'
                    })
                }
            }
        }
    }
    guardarDB(db)
    return penalizados
}

// ─── PARSEO DE MENSAJES ──────────────────────────────────────────────────────

const GANE_RE         = /gan[eé]|le\s+gan[eé]|venc[ií]/i
const PERDI_RE        = /perd[ií]|me\s+gan[oó]/i
const SETS_RE         = /(\d+[-–]\d+(?:\s+\d+[-–]\d+)*)/
const BOT_RE          = /marcador|torneobot|tenis|score/i
const GANA_DEF_RE     = /gana\s+a\s+.*\s+por\s+default/i
const PIERDE_DEF_RE   = /pierde\s+con\s+.*\s+por\s+default/i
const GANA_WO_RE      = /gana\s+a\s+.*\s+por\s+walk\s*over/i
const PIERDE_WO_RE    = /pierde\s+con\s+.*\s+por\s+walk\s*over/i

function esMensajeTorneo(texto, menciones) {
    const tiene_bot    = BOT_RE.test(texto)
    const tiene_accion = GANE_RE.test(texto) || PERDI_RE.test(texto) ||
                         GANA_DEF_RE.test(texto) || PIERDE_DEF_RE.test(texto) ||
                         GANA_WO_RE.test(texto) || PIERDE_WO_RE.test(texto)
    const tiene_mencion = menciones.length >= 1
    return (tiene_bot || tiene_mencion) && tiene_accion
}

function parsearMensaje(texto, numero_remitente, menciones_nums) {
    const remitente = numeroAJugador(numero_remitente)
    if (!remitente) return { error: '⚠️ Tu número no está registrado. Habla con el administrador.' }

    // Resolver mencionados por número directo (Baileys da números reales, no LIDs)
    const mencionados = menciones_nums
        .map(jid => {
            const num = jid.replace('@s.whatsapp.net','').replace('@lid','')
            return numeroAJugador(num)
        })
        .filter(j => j && j.nombre !== remitente.nombre)

    // ── Formato directo: @Javier gana a @German por default ──────────────
    const es_gana_def  = GANA_DEF_RE.test(texto)
    const es_pierde_def= PIERDE_DEF_RE.test(texto)
    const es_gana_wo   = GANA_WO_RE.test(texto)
    const es_pierde_wo = PIERDE_WO_RE.test(texto)

    if (es_gana_def || es_pierde_def || es_gana_wo || es_pierde_wo) {
        const tipo = (es_gana_def || es_pierde_def) ? 'default' : 'walkover'
        // Necesitamos al menos 2 mencionados para saber quién ganó y quién perdió
        // Incluir al remitente si está en la lista
        const todos = menciones_nums
            .map(jid => numeroAJugador(jid.replace('@s.whatsapp.net','').replace('@lid','')))
            .filter(j => j)

        if (todos.length < 2) {
            return { error: (
                '❌ Para reportar default o walkover menciona a ambos jugadores.\n\n' +
                'Ejemplo:\n_@Javier gana a @German por default_\n_@German pierde con @Javier por walkover_'
            )}
        }
        let ganador_j, perdedor_j
        if (es_gana_def || es_gana_wo) {
            ganador_j = todos[0]; perdedor_j = todos[1]
        } else {
            perdedor_j = todos[0]; ganador_j = todos[1]
        }
        return { remitente, ganador_directo: ganador_j, perdedor_directo: perdedor_j,
                 sets_str: tipo === 'walkover' ? 'W.O.' : 'DEF', tipo, modo: 'directo', error: null }
    }

    // ── Formato clásico: yo gané/perdí ───────────────────────────────────
    const rival = mencionados[0]
    if (!rival) {
        return { error: (
            '❌ No identifiqué al rival. Menciona a tu contrincante con @.\n\n' +
            'Ejemplos:\n_@Marcador le gané a @Javier 6-4 6-2_\n_@Marcador perdí con @Javier 6-4 6-2_\n' +
            '_@Javier gana a @German por default_'
        )}
    }

    const gano   = GANE_RE.test(texto)
    const perdio = PERDI_RE.test(texto)
    if (gano && perdio) return { error: '❌ No entendí. Usa "gané" o "perdí", no ambos.' }
    if (!gano && !perdio) return { error: '❌ No entendí el resultado.\n\nEjemplos:\n_@Marcador le gané a @Javier 6-4 6-2_\n_@Marcador perdí con @Javier 6-4 6-2_' }

    const sets_match = SETS_RE.exec(texto)
    if (!sets_match) return { error: '❌ No encontré el marcador. Escríbelo así: *6-4 6-2*' }

    return { remitente, rival, gano_remitente: gano,
             sets_str: sets_match[1].trim(), tipo: 'jugado', modo: 'clasico', error: null }
}

// ─── FIN DE MES AUTOMÁTICO ───────────────────────────────────────────────────

function programarFinDeMes(callback) {
    const ahora = new Date()
    const fin_mes = new Date(ahora.getFullYear(), ahora.getMonth()+1, 0, 23, 55, 0)
    const ms = fin_mes - ahora
    console.log(`[FIN MES] Programado para: ${fin_mes.toISOString()} (en ${Math.round(ms/3600000)}h)`)
    setTimeout(() => {
        const penalizados = aplicarNoReportados()
        callback(penalizados)
        programarFinDeMes(callback)  // reprogramar para el siguiente mes
    }, ms)
}

module.exports = {
    getDB, initTorneo, cargarDB, guardarDB,
    numeroAJugador, nombreAJugador,
    tablaOrdenada, registrarResultado, aplicarNoReportados,
    esMensajeTorneo, parsearMensaje,
    programarFinDeMes
}
