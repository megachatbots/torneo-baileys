const sharp = require('sharp')

// Colores
const C = {
    titulo_bg: '#1e3c78', titulo_fg: '#ffffff',
    header_bg: '#3c64aa', header_fg: '#ffffff',
    grupo_bg:  '#c8d7f0', grupo_fg:  '#142864',
    row_odd:   '#f5f8ff', row_even:  '#ffffff',
    border:    '#b4bedd',
    sube:  '#b4e6b4', queda: '#fff0b4', baja: '#ffb4b4',
    win:   '#b4e6b4', loss:  '#ffb4b4', none: '#dcdcdc', diag: '#969696',
    pts_fg:'#145014', bg:   '#f0f4fc',
}

function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3),16)
    const g = parseInt(hex.slice(3,5),16)
    const b = parseInt(hex.slice(5,7),16)
    return { r, g, b }
}

// Genera SVG y lo convierte a PNG con sharp
async function generarTabla(db, solo_grupo = null) {
    const grupos = solo_grupo
        ? { [solo_grupo]: db.grupos[solo_grupo] }
        : db.grupos

    const num_grupos = Object.keys(grupos).length
    const n_jug = Math.max(...Object.values(grupos).map(g => Object.keys(g.jugadores).length))

    const col_no  = 30, col_nom = 130, col_mat = 65
    const col_jg  = 40, col_jp  = 40, col_pts = 50, col_pos = 40
    const ancho_grupo = col_no + col_nom + (n_jug * col_mat) + col_jg + col_jp + col_pts + col_pos

    const row_h = 28, header_h = 30, grupo_h = 28
    const titulo_h = 52, leyenda_h = 44
    const padding = 20, gap = 24

    const img_w = padding*2 + num_grupos * ancho_grupo + (num_grupos-1) * gap
    const img_h = padding*2 + titulo_h + grupo_h + header_h + n_jug*row_h + 14 + leyenda_h

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${img_w}" height="${img_h}">`
    svg += `<rect width="${img_w}" height="${img_h}" fill="${C.bg}"/>`

    // ── Título ────────────────────────────────────────────────────────────
    svg += rect(padding, padding, img_w-padding*2, titulo_h, C.titulo_bg)
    svg += text(db.nombre.toUpperCase(), img_w/2, padding+titulo_h/2, 18, C.titulo_fg, 'bold', 'middle', 'center')

    // ── Grupos ────────────────────────────────────────────────────────────
    let x = padding
    const y_start = padding + titulo_h + 10

    for (const [gn, gd] of Object.entries(grupos)) {
        const partidos_grupo = db.partidos.filter(p => p.grupo === gn)

        // Ordenar jugadores por pts
        const jugadores = Object.entries(gd.jugadores).sort((a,b) => {
            if (b[1].pts !== a[1].pts) return b[1].pts - a[1].pts
            return (b[1].sets_f-b[1].sets_c) - (a[1].sets_f-a[1].sets_c)
        })
        const nombres = jugadores.map(j => j[0])
        const n = nombres.length

        // Mapa de resultados
        const res_map = {}
        for (const p of partidos_grupo) {
            if (p.tipo === 'no_reportado') continue
            res_map[`${p.ganador}|${p.perdedor}`] = { sets: p.sets, tipo: p.tipo, gano: true }
            res_map[`${p.perdedor}|${p.ganador}`] = { sets: p.sets, tipo: p.tipo, gano: false }
        }

        let y = y_start

        // Header grupo
        svg += rect(x, y, ancho_grupo, grupo_h, C.grupo_bg, C.border)
        svg += text(gn.toUpperCase(), x+ancho_grupo/2, y+grupo_h/2, 13, C.grupo_fg, 'bold', 'middle', 'center')
        y += grupo_h

        // Headers columnas
        const cols_h = [
            ['No.', col_no, x],
            ['NOMBRE', col_nom, x+col_no],
            ...nombres.map((nm, i) => [nm.substring(0,4).toUpperCase(), col_mat, x+col_no+col_nom+i*col_mat]),
            ['JG', col_jg, x+col_no+col_nom+n*col_mat],
            ['JP', col_jp, x+col_no+col_nom+n*col_mat+col_jg],
            ['PTS', col_pts, x+col_no+col_nom+n*col_mat+col_jg+col_jp],
            ['POS', col_pos, x+col_no+col_nom+n*col_mat+col_jg+col_jp+col_pts],
        ]
        for (const [label, w, cx] of cols_h) {
            svg += rect(cx, y, w, header_h, C.header_bg, C.border)
            svg += text(label, cx+w/2, y+header_h/2, 10, C.header_fg, 'bold', 'middle', 'center')
        }
        y += header_h

        // Filas
        for (let i = 0; i < jugadores.length; i++) {
            const [nombre, stats] = jugadores[i]
            const pos = i+1
            const bg = i%2===0 ? C.row_odd : C.row_even
            const color_pos = n===3
                ? (pos===1?C.sube : pos===2?C.queda : C.baja)
                : (pos<=2?C.sube : pos===3?C.queda : C.baja)
            const flecha = color_pos===C.sube?'↑' : color_pos===C.queda?'–' : '↓'

            let cx = x

            // No.
            svg += rect(cx, y, col_no, row_h, bg, C.border)
            svg += text(String(pos), cx+col_no/2, y+row_h/2, 12, '#000', 'normal', 'middle', 'center')
            cx += col_no

            // Nombre
            svg += rect(cx, y, col_nom, row_h, bg, C.border)
            svg += text(nombre, cx+6, y+row_h/2, 12, '#142850', 'bold', 'middle', 'start')
            cx += col_nom

            // Matriz
            for (const rival of nombres) {
                let cell_bg = C.none, cell_txt = ''
                if (rival === nombre) {
                    cell_bg = C.diag
                } else {
                    const key = `${nombre}|${rival}`
                    if (res_map[key]) {
                        const r = res_map[key]
                        cell_bg = r.gano ? C.win : C.loss
                        cell_txt = r.tipo==='walkover'?'W.O.' : r.tipo==='default'?'DEF' : r.sets
                    }
                }
                svg += rect(cx, y, col_mat, row_h, cell_bg, C.border)
                if (cell_txt) svg += text(cell_txt, cx+col_mat/2, y+row_h/2, 9, '#000', 'normal', 'middle', 'center')
                cx += col_mat
            }

            // JG, JP
            svg += rect(cx, y, col_jg, row_h, bg, C.border)
            svg += text(String(stats.juegos_f), cx+col_jg/2, y+row_h/2, 12, '#000', 'normal', 'middle', 'center')
            cx += col_jg
            svg += rect(cx, y, col_jp, row_h, bg, C.border)
            svg += text(String(stats.juegos_c), cx+col_jp/2, y+row_h/2, 12, '#000', 'normal', 'middle', 'center')
            cx += col_jp

            // PTS
            svg += rect(cx, y, col_pts, row_h, bg, C.border)
            svg += text(String(stats.pts), cx+col_pts/2, y+row_h/2, 12, C.pts_fg, 'bold', 'middle', 'center')
            cx += col_pts

            // POS
            svg += rect(cx, y, col_pos, row_h, color_pos, C.border)
            svg += text(flecha, cx+col_pos/2, y+row_h/2, 14, '#333', 'bold', 'middle', 'center')
            cx += col_pos

            y += row_h
        }

        x += ancho_grupo + gap
    }

    // ── Leyenda ───────────────────────────────────────────────────────────
    const y_ley = img_h - leyenda_h + 10
    const leyenda = [[C.sube,'↑ Sube'],[C.queda,'– Se queda'],[C.baja,'↓ Baja']]
    let lx = padding
    for (const [color, label] of leyenda) {
        svg += rect(lx, y_ley, 16, 16, color, C.border)
        svg += text(label, lx+22, y_ley+8, 11, '#333', 'normal', 'middle', 'start')
        lx += 130
    }

    svg += '</svg>'

    // Convertir SVG a PNG con sharp
    const png = await sharp(Buffer.from(svg)).png().toBuffer()
    return png
}

function rect(x, y, w, h, fill, stroke='none') {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="0.5"/>`
}

function text(content, x, y, size, fill, weight, baseline, anchor) {
    // Escapar caracteres especiales XML
    const safe = String(content)
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
    const dom = baseline==='middle' ? 'central' : baseline
    return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" dominant-baseline="${dom}" text-anchor="${anchor}" font-family="Arial,sans-serif">${safe}</text>`
}

module.exports = { generarTabla }
