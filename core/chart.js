class BasicChart {
    static CHART_WIDTH = 300;
    static CHART_HEIGHT = 100;
    static CHART_MAX_POINTS = 60;
    static FPS_CHART_MAX_FPS_VALUE = 120;

    static Style = Object.freeze({
        AREA: 'area',       // filled area under the series
        LINE: 'line',       // straight segments, no fill
        STEP: 'step',       // hold each value until the next sample
        SMOOTH: 'smooth',   // curve through the samples, no fill
    });

    constructor(chartId, name = '', maxPoints = BasicChart.CHART_MAX_POINTS, maxValue = BasicChart.FPS_CHART_MAX_FPS_VALUE, unit = '', {
        style = BasicChart.Style.AREA, grid = true, sampleSeconds = 1, gridSeconds = 5
    } = {}) {
        this.id = chartId;
        this.name = name;
        this.unit = unit;
        this.data = [];
        this.maxPoints = maxPoints;
        this.maxValue = maxValue;
        this.width = BasicChart.CHART_WIDTH;
        this.height = BasicChart.CHART_HEIGHT;
        this.minValue = null;
        this.maxRecorded = null;
        this.style = style;
        this.grid = grid;
        this.sampleSeconds = sampleSeconds;
        this.gridSeconds = gridSeconds;
        this.sampleCount = 0;
        this.labelSuffix = '';
        this.group = [this];
        this.scaleOwner = this;

        if (name) {
            this.createLabel();
        }
    }

    createLabel() {
        const pathElement = document.getElementById(this.id);
        if (!pathElement) return;

        const svgElement = pathElement.closest('svg');
        if (!svgElement) return;

        const chartContainer = svgElement.parentElement;
        if (!chartContainer) return;

        // Create or update label element
        let labelId = `${this.id}_label`;
        let labelElement = document.getElementById(labelId);

        if (!labelElement) {
            labelElement = document.createElement('div');
            labelElement.id = labelId;
            labelElement.style.cssText = 'font-size: 12px; color: #fff; margin-bottom: 5px;';
            chartContainer.insertBefore(labelElement, svgElement);
        }

        this.updateLabel();
    }

    updateLabel() {
        const labelId = `${this.id}_label`;
        const labelElement = document.getElementById(labelId);

        if (labelElement) {
            const min = this.minValue !== null ? this.formatValue(this.minValue) : 'N/A';
            const max = this.maxRecorded !== null ? this.formatValue(this.maxRecorded) : 'N/A';
            labelElement.textContent = `${this.name} - Min: ${min}, Max: ${max}${this.labelSuffix}`;
        }
    }

    formatValue(value) {
        if (this.unit === 'bytes/s') {
            const bits = value * 8;
            return bits >= 1000000 ? `${Number((bits / 1000000).toFixed(2))} Mbps` : `${Math.round(bits / 1000)} Kbps`;
        }
        return `${Number(value.toFixed(2))}${this.unit ? ` ${this.unit}` : ''}`;
    }

    linkScale(...others) {
        const group = [...new Set([...this.group, ...others.flatMap(c => c.group)])];
        group.forEach(c => {
            c.group = group;
            c.scaleOwner = this;
        });
        this.setSize(this.width, this.height);
    }

    setSize(width, height) {
        for (const c of this.group) {
            c.width = width;
            c.height = height;
            const svg = document.getElementById(c.id)?.closest('svg');
            if (svg) {
                svg.setAttribute('width', width);
                svg.setAttribute('height', height);
                svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
            }
            c.render();
        }
    }

    scaleMaximum() {
        const owner = this.scaleOwner;
        return Math.max(owner.maxValue, ...owner.data) || 1;
    }

    render() {
        const path = document.getElementById(this.id);
        if (path) {
            path.setAttribute('d', this.generateChartPoints());
        }
        if (this.grid) {
            this.updateGrid();
        }
    }

    updateGrid() {
        const svg = document.getElementById(this.id)?.closest('svg');
        if (!svg) return;
        const ns = 'http://www.w3.org/2000/svg';
        let grid = document.getElementById(`${this.id}_grid`);
        if (!grid) {
            grid = document.createElementNS(ns, 'g');
            grid.id = `${this.id}_grid`;
            svg.appendChild(grid);
        }
        grid.replaceChildren();

        const stepX = this.width / (this.maxPoints - 1);
        const samplesPerLine = Math.max(1, Math.round(this.gridSeconds / this.sampleSeconds));
        const firstSample = this.sampleCount - this.data.length;
        for (let n = firstSample; n < this.sampleCount; n++) {
            if (n % samplesPerLine !== 0) continue;
            const x = (n - firstSample) * stepX;
            const vline = document.createElementNS(ns, 'line');
            vline.setAttribute('x1', x);
            vline.setAttribute('x2', x);
            vline.setAttribute('y1', 0);
            vline.setAttribute('y2', this.height);
            vline.setAttribute('stroke', '#fff');
            vline.setAttribute('stroke-opacity', '0.3');
            grid.append(vline);
        }

        for (const fraction of [0.25, 0.5, 0.75, 1]) {
            const y = this.height * (1 - fraction);
            const line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', 0);
            line.setAttribute('x2', this.width);
            line.setAttribute('y1', y);
            line.setAttribute('y2', y);
            line.setAttribute('stroke', '#fff');
            line.setAttribute('stroke-opacity', '0.65');
            const label = document.createElementNS(ns, 'text');
            label.setAttribute('x', this.width - 4);
            label.setAttribute('y', y + 11);
            label.setAttribute('text-anchor', 'end');
            label.setAttribute('fill', '#fff');
            label.setAttribute('font-size', '10');
            label.setAttribute('stroke', '#333');
            label.setAttribute('stroke-width', '2');
            label.setAttribute('paint-order', 'stroke');
            label.textContent = this.formatValue(this.scaleMaximum() * fraction);
            grid.append(line, label);
        }
    }

    generateChartPoints() {
        if (this.data.length === 0) return '';

        const stepX = this.width / (this.maxPoints - 1);
        const scaleY = this.height / this.scaleMaximum();
        // A missing line sample breaks the path instead of implying zero.
        if (this.style === BasicChart.Style.LINE) {
            let path = '';
            let move = true;
            this.data.forEach((value, i) => {
                if (value === null) {
                    move = true;
                    return;
                }
                const y = Math.max(0, this.height - value * scaleY);
                path += `${path ? ' ' : ''}${move ? 'M' : 'L'} ${i * stepX} ${y}`;
                move = false;
            });
            return path;
        }
        const points = this.data.map((v, i) => [i * stepX, Math.max(0, this.height - v * scaleY)]);

        return this.buildPath(points);
    }

    buildPath(points) {
        const [firstX, firstY] = points[0];
        const [lastX] = points[points.length - 1];

        switch (this.style) {
            case BasicChart.Style.LINE:
                return `M ${firstX} ${firstY}` + points.slice(1).map(([x, y]) => ` L ${x} ${y}`).join('');

            case BasicChart.Style.STEP: {
                let d = `M ${firstX} ${firstY}`;
                for (let i = 1; i < points.length; i++) {
                    d += ` L ${points[i][0]} ${points[i - 1][1]} L ${points[i][0]} ${points[i][1]}`;
                }
                return d;
            }

            case BasicChart.Style.SMOOTH: {
                const clamp = (y) => Math.min(this.height, Math.max(0, y));
                let d = `M ${firstX} ${firstY}`;
                for (let i = 0; i < points.length - 1; i++) {
                    const p0 = points[i - 1] || points[i];
                    const p1 = points[i];
                    const p2 = points[i + 1];
                    const p3 = points[i + 2] || p2;
                    const c1y = clamp(p1[1] + (p2[1] - p0[1]) / 6);
                    const c2y = clamp(p2[1] - (p3[1] - p1[1]) / 6);
                    d += ` C ${p1[0] + (p2[0] - p0[0]) / 6} ${c1y} ${p2[0] - (p3[0] - p1[0]) / 6} ${c2y} ${p2[0]} ${p2[1]}`;
                }
                return d;
            }

            case BasicChart.Style.AREA:
            default:
                return `M 0 ${this.height}` + points.map(([x, y]) => ` L ${x} ${y}`).join('') + ` L ${lastX} ${this.height} L 0 ${this.height} Z`;
        }
    }

    record(value) {
        const gap = value === null && this.style === BasicChart.Style.LINE;
        if (!gap && (!Number.isFinite(value) || value < 0))
            return false;

        this.data.push(value);
        this.sampleCount++;
        if (this.data.length > this.maxPoints) {
            this.data.shift();
        }

        // Summarize the same rolling window that is plotted.
        const samples = this.data.filter(sample => sample !== null);
        this.minValue = samples.length ? Math.min(...samples) : null;
        this.maxRecorded = samples.length ? Math.max(...samples) : null;

        // Update label if it exists
        if (this.name) {
            this.updateLabel();
        }
        return true;
    }

    update(value) {
        if (!this.record(value))
            return;

        for (const c of this.group) {
            c.render();
        }
    }
}

export default BasicChart;