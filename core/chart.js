class BasicChart {
    static CHART_WIDTH = 200;
    static CHART_HEIGHT = 50;
    static CHART_MAX_POINTS = 60;
    static FPS_CHART_MAX_FPS_VALUE = 120;

    constructor(chartId, maxPoints = BasicChart.CHART_MAX_POINTS, maxValue = BasicChart.FPS_CHART_MAX_FPS_VALUE) {
        this.id = chartId;
        this.data = [];
        this.maxPoints = maxPoints;
        this.maxValue = maxValue;
        this.width = this.CHART_WIDTH;
        this.height = this.CHART_HEIGHT;
    }

    generateChartPoints() {
        if (this.data.length === 0) return '';

        const stepX = this.width / (this.maxPoints - 1);
        const effectiveMaxValue = this.maxValue || Math.max(...this.data) || 1;
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
        this.data.push(value);
        if (this.data.length > this.maxPoints) {
            this.data.shift();
        }

        const path = document.getElementById(this.id);
        if (path) {
            path.setAttribute('d', this.generateChartPoints());
        }
    }
}

export default BasicChart;