import * as Log from './logging.js';

export class PerformanceLogger {
    constructor(targetFps = 60) {
        this._targetFps = targetFps;
        this._targetFrameTime = 1000 / targetFps; // 16.67ms for 60 FPS

        // Timing metrics
        this._metrics = {
            // Network/Data reading
            frameRead: { total: 0, count: 0, max: 0, samples: [] },

            // Video decoding
            videoDecode: { total: 0, count: 0, max: 0, samples: [] },
            videoDecodeQueue: { total: 0, count: 0, max: 0, samples: [] },

            // Frame processing
            frameProcessing: { total: 0, count: 0, max: 0, samples: [] },
            rectProcessing: { total: 0, count: 0, max: 0, samples: [] },

            // Rendering
            canvasRender: { total: 0, count: 0, max: 0, samples: [] },
            webglRender: { total: 0, count: 0, max: 0, samples: [] },
            videoFrameRender: { total: 0, count: 0, max: 0, samples: [] },

            // Multi-screen
            broadcastChannelSend: { total: 0, count: 0, max: 0, samples: [] },
            screenRouting: { total: 0, count: 0, max: 0, samples: [] },

            // Queue operations
            asyncQueuePush: { total: 0, count: 0, max: 0, samples: [] },
            asyncFrameComplete: { total: 0, count: 0, max: 0, samples: [] },

            // Image operations
            imageLoad: { total: 0, count: 0, max: 0, samples: [] },
            imageBitmapCreate: { total: 0, count: 0, max: 0, samples: [] },

            // Frame-to-frame timing
            frameInterval: { total: 0, count: 0, max: 0, min: Infinity, samples: [] },

            // Total pipeline
            endToEnd: { total: 0, count: 0, max: 0, samples: [] },

            // Logging overhead tracking
            loggingOverhead: { total: 0, count: 0, max: 0, samples: [] }
        };

        // Keep track of samples for detailed analysis
        this._maxSamples = 100;
        this._lastFrameTime = 0;

        // Warnings
        this._slowFrameThreshold = this._targetFrameTime * 1.5; // 25ms for 60fps
        this._criticalFrameThreshold = this._targetFrameTime * 2; // 33ms for 60fps

        // Report interval
        this._reportInterval = null;
        this._enabled = false;

        // Logging performance tracking
        this._loggingStats = {
            startCalls: 0,
            endCalls: 0,
            totalStartTime: 0,
            totalEndTime: 0,
            reportGenerationTime: 0,
            reportCount: 0
        };
    }

    enable(reportIntervalMs = 5000) {
        this._enabled = true;
        Log.Info(`Performance logging enabled. Target: ${this._targetFps} FPS (${this._targetFrameTime.toFixed(2)}ms per frame)`);

        if (reportIntervalMs > 0) {
            this._reportInterval = setInterval(() => {
                this.generateReport();
            }, reportIntervalMs);
        }
    }

    disable() {
        this._enabled = false;
        if (this._reportInterval) {
            clearInterval(this._reportInterval);
            this._reportInterval = null;
        }
        Log.Info('Performance logging disabled');
    }

    start(operation) {
        if (!this._enabled) return 0;

        const overheadStart = performance.now();
        const timestamp = performance.now();

        // Track logging overhead
        this._loggingStats.startCalls++;
        this._loggingStats.totalStartTime += (performance.now() - overheadStart);

        return timestamp;
    }

    end(operation, startTime) {
        if (!this._enabled || startTime === 0) return;

        const overheadStart = performance.now();

        const duration = performance.now() - startTime;
        const metric = this._metrics[operation];

        if (!metric) {
            Log.Warn(`Unknown performance metric: ${operation}`);
            this._loggingStats.endCalls++;
            this._loggingStats.totalEndTime += (performance.now() - overheadStart);
            return;
        }

        metric.total += duration;
        metric.count++;
        metric.max = Math.max(metric.max, duration);

        // Keep rolling samples
        metric.samples.push(duration);
        if (metric.samples.length > this._maxSamples) {
            metric.samples.shift();
        }

        // Track min for frame interval
        if (operation === 'frameInterval') {
            metric.min = Math.min(metric.min, duration);
        }

        // Warn on slow operations
        if (duration > this._criticalFrameThreshold) {
            Log.Error(`CRITICAL: ${operation} took ${duration.toFixed(2)}ms (threshold: ${this._criticalFrameThreshold.toFixed(2)}ms)`);
        } else if (duration > this._slowFrameThreshold) {
            Log.Warn(`SLOW: ${operation} took ${duration.toFixed(2)}ms (threshold: ${this._slowFrameThreshold.toFixed(2)}ms)`);
        }

        // Track logging overhead (excluding the warning logs above)
        this._loggingStats.endCalls++;
        const overheadDuration = performance.now() - overheadStart;
        this._loggingStats.totalEndTime += overheadDuration;

        // Record overhead as a metric
        const overheadMetric = this._metrics.loggingOverhead;
        overheadMetric.total += overheadDuration;
        overheadMetric.count++;
        overheadMetric.max = Math.max(overheadMetric.max, overheadDuration);
        overheadMetric.samples.push(overheadDuration);
        if (overheadMetric.samples.length > this._maxSamples) {
            overheadMetric.samples.shift();
        }
    }


    recordFrameInterval() {
        if (!this._enabled) return;

        const now = performance.now();
        if (this._lastFrameTime > 0) {
            const interval = now - this._lastFrameTime;
            this.end('frameInterval', this._lastFrameTime);
        }
        this._lastFrameTime = now;
    }


    _calculateStats(metric) {
        if (metric.count === 0) {
            return { avg: 0, max: 0, p95: 0, p99: 0, min: 0, count: 0 };
        }

        const avg = metric.total / metric.count;
        const sorted = [...metric.samples].sort((a, b) => a - b);
        const p95Index = Math.floor(sorted.length * 0.95);
        const p99Index = Math.floor(sorted.length * 0.99);

        const result = {
            avg: avg.toFixed(2),
            max: metric.max.toFixed(2),
            p95: sorted[p95Index]?.toFixed(2) || 0,
            p99: sorted[p99Index]?.toFixed(2) || 0,
            count: metric.count
        };

        // Only include min if it exists (for frameInterval)
        if (metric.min !== undefined && metric.min !== Infinity) {
            result.min = metric.min.toFixed(2);
        }

        return result;
    }

    generateReport() {
        if (!this._enabled) return;

        const reportStart = performance.now();

        Log.Info('=== PERFORMANCE REPORT ===');
        Log.Info(`Target: ${this._targetFps} FPS (${this._targetFrameTime.toFixed(2)}ms per frame)`);
        Log.Info('');

        const categories = {
            'Network & Data': ['frameRead'],
            'Video Decoding': ['videoDecode', 'videoDecodeQueue'],
            'Frame Processing': ['frameProcessing', 'rectProcessing', 'screenRouting'],
            'Rendering': ['canvasRender', 'webglRender', 'videoFrameRender'],
            'Queue Operations': ['asyncQueuePush', 'asyncFrameComplete'],
            'Image Operations': ['imageLoad', 'imageBitmapCreate'],
            'Multi-Monitor': ['broadcastChannelSend'],
            'Frame Timing': ['frameInterval', 'endToEnd'],
            'Logging Performance': ['loggingOverhead']
        };

        let bottlenecks = [];

        for (const [category, operations] of Object.entries(categories)) {
            Log.Info(`--- ${category} ---`);

            for (const op of operations) {
                const stats = this._calculateStats(this._metrics[op]);

                if (stats.count > 0) {
                    const isSlow = parseFloat(stats.avg) > this._targetFrameTime;
                    const isCritical = parseFloat(stats.avg) > this._criticalFrameThreshold;

                    const marker = isCritical ? 'CRITICAL' : (isSlow ? 'SLOW' : '');

                    Log.Info(`${marker} ${op}:`);
                    Log.Info(`   Avg: ${stats.avg}ms | Max: ${stats.max}ms | P95: ${stats.p95}ms | P99: ${stats.p99}ms | Count: ${stats.count}`);

                    if (op === 'frameInterval') {
                        Log.Info(`   Min: ${stats.min}ms`);
                        const avgFps = (1000 / parseFloat(stats.avg)).toFixed(2);
                        Log.Info(`   Actual FPS: ${avgFps}`);
                    }

                    if (isCritical || isSlow) {
                        bottlenecks.push({
                            operation: op,
                            avg: parseFloat(stats.avg),
                            max: parseFloat(stats.max),
                            severity: isCritical ? 'CRITICAL' : 'SLOW'
                        });
                    }
                }
            }
            Log.Info('');
        }

        if (bottlenecks.length > 0) {
            Log.Warn('=== BOTTLENECKS IDENTIFIED ===');
            bottlenecks.sort((a, b) => b.avg - a.avg);

            bottlenecks.forEach((b, i) => {
                const pct = ((b.avg / this._targetFrameTime) * 100).toFixed(0);
                Log.Warn(`${i + 1}. [${b.severity}] ${b.operation}: ${b.avg.toFixed(2)}ms avg (${pct}% of frame budget), ${b.max.toFixed(2)}ms max`);
            });

            Log.Warn('');
            Log.Warn('Recommendations:');
            bottlenecks.slice(0, 3).forEach((b, i) => {
                Log.Warn(`${i + 1}. Optimize ${b.operation} - currently using ${((b.avg / this._targetFrameTime) * 100).toFixed(0)}% of frame time budget`);
            });
        } else {
            Log.Info('OK - No bottlenecks detected - performance within targets');
        }

        Log.Info('');
        Log.Info('--- Logging Performance Summary ---');
        const avgStartOverhead = this._loggingStats.startCalls > 0
            ? (this._loggingStats.totalStartTime / this._loggingStats.startCalls).toFixed(4)
            : 0;
        const avgEndOverhead = this._loggingStats.endCalls > 0
            ? (this._loggingStats.totalEndTime / this._loggingStats.endCalls).toFixed(4)
            : 0;

        Log.Info(`Start calls: ${this._loggingStats.startCalls} (avg: ${avgStartOverhead}ms per call)`);
        Log.Info(`End calls: ${this._loggingStats.endCalls} (avg: ${avgEndOverhead}ms per call)`);
        Log.Info(`Total logging overhead: ${(this._loggingStats.totalStartTime + this._loggingStats.totalEndTime).toFixed(2)}ms`);

        const overheadStats = this._calculateStats(this._metrics.loggingOverhead);
        if (overheadStats.count > 0) {
            Log.Info(`Per-operation overhead: avg ${overheadStats.avg}ms | max ${overheadStats.max}ms | p95 ${overheadStats.p95}ms`);
            const overheadPercentage = ((parseFloat(overheadStats.avg) / this._targetFrameTime) * 100).toFixed(2);

            if (parseFloat(overheadPercentage) > 5) {
                Log.Warn(`WARNING Logging overhead is ${overheadPercentage}% of frame budget - consider reducing logging frequency`);
            } else {
                Log.Info(`OK Logging overhead is acceptable (${overheadPercentage}% of frame budget)`);
            }
        }

        // Track report generation time
        const reportDuration = performance.now() - reportStart;
        this._loggingStats.reportGenerationTime += reportDuration;
        this._loggingStats.reportCount++;
        const avgReportTime = (this._loggingStats.reportGenerationTime / this._loggingStats.reportCount).toFixed(2);
        Log.Info(`Report generation time: ${reportDuration.toFixed(2)}ms (avg: ${avgReportTime}ms)`);

        Log.Info('=== END PERFORMANCE REPORT ===');
    }

    reset() {
        for (const metric of Object.values(this._metrics)) {
            metric.total = 0;
            metric.count = 0;
            metric.max = 0;
            metric.min = Infinity;
            metric.samples = [];
        }
        this._lastFrameTime = 0;

        // Reset logging stats
        this._loggingStats = {
            startCalls: 0,
            endCalls: 0,
            totalStartTime: 0,
            totalEndTime: 0,
            reportGenerationTime: 0,
            reportCount: 0
        };

        Log.Info('Performance metrics reset');
    }

    getMetrics() {
        const result = {};
        for (const [key, metric] of Object.entries(this._metrics)) {
            result[key] = this._calculateStats(metric);
        }
        return result;
    }

    getLoggingStats() {
        const avgStartOverhead = this._loggingStats.startCalls > 0
            ? (this._loggingStats.totalStartTime / this._loggingStats.startCalls)
            : 0;
        const avgEndOverhead = this._loggingStats.endCalls > 0
            ? (this._loggingStats.totalEndTime / this._loggingStats.endCalls)
            : 0;
        const avgReportTime = this._loggingStats.reportCount > 0
            ? (this._loggingStats.reportGenerationTime / this._loggingStats.reportCount)
            : 0;

        const totalOverhead = this._loggingStats.totalStartTime + this._loggingStats.totalEndTime;
        const overheadPercentage = this._loggingStats.endCalls > 0
            ? ((totalOverhead / this._loggingStats.endCalls) / this._targetFrameTime * 100)
            : 0;

        return {
            startCalls: this._loggingStats.startCalls,
            endCalls: this._loggingStats.endCalls,
            avgStartOverhead: avgStartOverhead.toFixed(4) + 'ms',
            avgEndOverhead: avgEndOverhead.toFixed(4) + 'ms',
            totalOverhead: totalOverhead.toFixed(2) + 'ms',
            reportCount: this._loggingStats.reportCount,
            avgReportTime: avgReportTime.toFixed(2) + 'ms',
            overheadPercentage: overheadPercentage.toFixed(2) + '%',
            isAcceptable: overheadPercentage < 5
        };
    }
}

export const perfLogger = new PerformanceLogger(60);
