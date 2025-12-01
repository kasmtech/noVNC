class BasicChart {
    static CHART_WIDTH = 200;
    static CHART_HEIGHT = 50;
    static CHART_MAX_POINTS = 60;

    constructor(chartId, name = '', maxPoints = BasicChart.CHART_MAX_POINTS, maxValue = undefined) {
        this.id = chartId;
        this.name = name;
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
            const min = this.minValue !== null ? this.minValue.toFixed(2) : 'N/A';
            const max = this.maxRecorded !== null ? this.maxRecorded.toFixed(2) : 'N/A';
            labelElement.textContent = `${this.name} - Min: ${min}, Max: ${max}`;
        }
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

        // Update min/max values
        if (this.minValue === null || value < this.minValue) {
            this.minValue = value;
        }
        if (this.maxRecorded === null || value > this.maxRecorded) {
            this.maxRecorded = value;
        }

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