class BasicChart {
    static CHART_WIDTH = 300;
    static CHART_HEIGHT = 100;
    static CHART_MAX_POINTS = 60;
    static FPS_CHART_MAX_FPS_VALUE = 120;

    constructor(chartId, name = '', maxPoints = BasicChart.CHART_MAX_POINTS, maxValue = BasicChart.FPS_CHART_MAX_FPS_VALUE, unit = '') {
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
            labelElement.textContent = `${this.name} - Min: ${min}, Max: ${max}`;
        }
    }

    formatValue(value) {
        if (this.unit === 'bytes/s') {
            const bits = value * 8;
            return bits >= 1000000
                ? `${Number((bits / 1000000).toFixed(2))} Mbps`
                : `${Math.round(bits / 1000)} Kbps`;
        }
        return `${Number(value.toFixed(2))}${this.unit ? ` ${this.unit}` : ''}`;
    }

    scaleMaximum() {
        return Math.max(this.maxValue, ...this.data) || 1;
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
        const effectiveMaxValue = this.scaleMaximum();
        const scaleY = this.height / effectiveMaxValue;

        let d = `M 0 ${this.height}`;

        for (let i = 0; i < this.data.length; i++) {
            const x = i * stepX;
            const y = this.height - this.data[i] * scaleY;
            d += ` L ${x} ${y}`;
        }

        d += ` L ${(this.data.length - 1) * stepX} ${this.height} L 0 ${this.height} Z`;

        return d;
    }

    update(value) {
        if (!Number.isFinite(value) || value < 0) return;
        this.data.push(value);
        if (this.data.length > this.maxPoints) {
            this.data.shift();
        }

        // Summarize the same rolling window that is plotted.
        this.minValue = Math.min(...this.data);
        this.maxRecorded = Math.max(...this.data);
        this.updateGrid();

        const path = document.getElementById(this.id);
        if (path) {
            path.setAttribute('d', this.generateChartPoints());
        }

        // Update label if it exists
        if (this.name) {
            this.updateLabel();
        }
    }
}

export default BasicChart;