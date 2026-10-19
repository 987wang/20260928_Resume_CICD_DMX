// 鼠标跟随炫彩烟雾。
// 原理：canvas 径向渐变画出「中间亮、边缘透明」的柔化烟团，
// 模拟烟雾扩散、上浮、慢慢消散。
// 单独一个文件，不干扰页面上原有的 JS，方便 CI/CD 维护。

const canvas = document.getElementById('smokeCanvas')
const ctx = canvas.getContext('2d')

let w
let h
const smokeList = []
let baseHue = Math.random() * 360 // 彩虹的起点色相，每次刷新都不一样
let lastX = null // 上一次撒烟团的位置，用来判断"这次移动够不够远"
let lastY = null

const STEP = 5 // 沿鼠标划过的路线每隔这么远撒一团；调大 = 团更稀疏、痕迹更轻
const MAX_PER_MOVE = 12 // 一次移动最多撒这么多团，防止鼠标"瞬移"时爆量

// 画布自适应窗口大小。
//
// 坑：<canvas> 是「替换元素」，和普通 div 不一样——只写 position:fixed; inset:0
// 并不会把它撑满视口，它会缩回自身的 width/height 属性（默认 300×150）。
// 所以这里不能用 canvas.clientWidth/clientHeight 去量尺寸：量到的就是那个 300，
// 画布和绘制缓冲区都只剩左上角一小块，鼠标划到哪儿都只在一小片里出颜色。
// 改用 documentElement.clientWidth/Height（视口可视区域，不含滚动条），
// 并用行内样式把 CSS 尺寸钉死，不依赖样式表是否生效。
// 最后按 devicePixelRatio 放大绘制缓冲区，retina 屏上烟才不会糊。
function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    w = document.documentElement.clientWidth
    h = document.documentElement.clientHeight
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}
resizeCanvas()
window.addEventListener('resize', resizeCanvas)

// 烟团
class Smoke {
    constructor(x, y, hue) {
        this.x = x
        this.y = y
        this.radius = Math.random() * 22 + 10 // 起始半径 10~32px
        this.vx = (Math.random() - 0.5) * 0.6
        this.vy = (Math.random() - 0.8) * 0.8 // 负数偏多，整体往上飘
            // 单个团的浓淡。擦淡慢、同一条划痕上叠的团就多，单个团一浓就会发闷成紫色，
            // 所以单个团偏淡（0.35），颜色靠一层层叠加慢慢出来。
        this.alpha = 0.35
            // 每帧减掉多少不透明度。原来是 0.005~0.013，烟团只活 0.8~2 秒，
            // 痕迹一闪就没了；现在 0.002~0.006，活 1.7~5 秒，是慢慢散开的。
        this.decay = Math.random() * 0.004 + 0.002
        this.hue = hue
    }

    update() {
        this.x += this.vx
        this.y += this.vy
        this.radius *= 1.015 // 烟雾持续扩大；调大就会往外铺开、显得夸张
        this.alpha -= this.decay
    }

    draw() {
        // 径向渐变：中心亮、边缘透明，所以没有硬圆形边框，看着是柔和的烟
        const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius)
            // 亮度 62%：白底 + multiply 会把颜色稀释一点，太亮（70%）几乎看不见，
            // 太暗（58%）叠起来发闷；62% 是"单个团淡淡一层、叠起来越来越彩"。
        grad.addColorStop(0, `hsla(${this.hue}, 92%, 62%, ${this.alpha})`)
        grad.addColorStop(1, `hsla(${this.hue}, 92%, 62%, 0)`)
        ctx.beginPath()
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2)
        ctx.fillStyle = grad
        ctx.fill()
    }
}

// 鼠标移动时生成烟团。三个细节决定它是"一整条彩虹"还是"只有一点点"：
//  1) 沿着这一小段路每隔 STEP 撒一团。鼠标移动快时，一个 mousemove 事件
//     可能跨几十像素，只在终点撒一团的话中间是断的，看起来就稀稀拉拉；
//  2) 色相跟着划过的距离往前走，一条划过去就是一道彩虹。相邻烟团颜色接近，
//     叠起来是同一个色加深；而每个烟团随机取色的话，互补色一叠就变灰；
//  3) 位置加一点随机偏移，团与团错开，边缘更像云而不是一条实线。
window.addEventListener('mousemove', event => {
    if (lastX === null) {
        lastX = event.clientX
        lastY = event.clientY
        return
    }
    const dx = event.clientX - lastX
    const dy = event.clientY - lastY
    const dist = Math.hypot(dx, dy)
    if (dist < STEP) return // 手在同一个地方微抖时不撒，避免叠成一坨脏色

    const count = Math.min(Math.floor(dist / STEP), MAX_PER_MOVE)
    const step = dist / count
    for (let i = 1; i <= count; i++) {
        const t = i / count
        baseHue = (baseHue + step * 0.7) % 360
        smokeList.push(
            new Smoke(
                lastX + dx * t + (Math.random() - 0.5) * 12,
                lastY + dy * t + (Math.random() - 0.5) * 12,
                baseHue
            )
        )
    }
    lastX = event.clientX
    lastY = event.clientY
})

// 动画循环
function animate() {
    // 每帧把已经画上的像素按比例抠掉，做出痕迹逐渐散开的效果。
    // destination-out 的意思是「按这个 alpha 把已有像素抠掉」，
    // 颜色写什么都无所谓，只有最后那个数字起作用。
    //
    // 这个数字决定痕迹能活多久：0.06 是每帧抠 6%，1 秒后就只剩 2%，
    // 划过去几乎看不见（就是当初"只有一点点"的原因）；现在 0.015 大约 2~3 秒
    // 才散干净，划过的整条彩虹都留得住。也别调得太小，否则旧痕迹散得太慢，
    // 来回多划几趟页面会显得脏。
    //
    // 不要改回"用颜色直接盖"的写法（即原来那行 rgba(0,0,0,0.06)）：
    // 那是拿黑色涂满整块画布，每秒叠 60 次，不到 1 秒就积成不透明纯黑，
    // 而画布又在整页最上层，结果白底被黑布盖住、烟也被吃掉。
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillStyle = 'rgba(0,0,0,0.015)'
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'source-over' // 立刻改回来，否则下面的烟画不出来

    for (let i = smokeList.length - 1; i >= 0; i--) {
        const smoke = smokeList[i]
        smoke.update()
        smoke.draw()
        if (smoke.alpha <= 0) {
            smokeList.splice(i, 1)
        }
    }
    requestAnimationFrame(animate)
}
animate()