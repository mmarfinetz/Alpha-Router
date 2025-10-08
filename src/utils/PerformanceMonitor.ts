import { logInfo, logWarn, logError } from './logger';

export interface PerformanceMetrics {
    requestCount: number;
    successCount: number;
    failureCount: number;
    averageResponseTime: number;
    p95ResponseTime: number;
    timeoutCount: number;
    lastReset: number;
}

export class PerformanceMonitor {
    private metrics: PerformanceMetrics = {
        requestCount: 0,
        successCount: 0,
        failureCount: 0,
        averageResponseTime: 0,
        p95ResponseTime: 0,
        timeoutCount: 0,
        lastReset: Date.now()
    };
    
    private responseTimes: number[] = [];
    private readonly MAX_RESPONSE_TIME_SAMPLES = 1000;
    private readonly REPORTING_INTERVAL = 60000; // 1 minute
    private reportingTimer: NodeJS.Timeout | null = null;

    constructor() {
        this.startReporting();
    }

    recordRequest(startTime: number, success: boolean, isTimeout: boolean = false): void {
        const responseTime = Date.now() - startTime;
        
        this.metrics.requestCount++;
        
        if (success) {
            this.metrics.successCount++;
        } else {
            this.metrics.failureCount++;
            if (isTimeout) {
                this.metrics.timeoutCount++;
            }
        }

        // Track response times for successful requests
        if (success) {
            this.responseTimes.push(responseTime);
            
            // Keep only the most recent samples
            if (this.responseTimes.length > this.MAX_RESPONSE_TIME_SAMPLES) {
                this.responseTimes = this.responseTimes.slice(-this.MAX_RESPONSE_TIME_SAMPLES);
            }
            
            this.updateResponseTimeMetrics();
        }
    }

    private updateResponseTimeMetrics(): void {
        if (this.responseTimes.length === 0) return;
        
        const sorted = [...this.responseTimes].sort((a, b) => a - b);
        const sum = this.responseTimes.reduce((acc, time) => acc + time, 0);
        
        this.metrics.averageResponseTime = sum / this.responseTimes.length;
        
        // Calculate P95
        const p95Index = Math.floor(sorted.length * 0.95);
        this.metrics.p95ResponseTime = sorted[p95Index] || 0;
    }

    getMetrics(): PerformanceMetrics {
        return { ...this.metrics };
    }

    getSuccessRate(): number {
        if (this.metrics.requestCount === 0) return 0;
        return (this.metrics.successCount / this.metrics.requestCount) * 100;
    }

    getTimeoutRate(): number {
        if (this.metrics.requestCount === 0) return 0;
        return (this.metrics.timeoutCount / this.metrics.requestCount) * 100;
    }

    reset(): void {
        this.metrics = {
            requestCount: 0,
            successCount: 0,
            failureCount: 0,
            averageResponseTime: 0,
            p95ResponseTime: 0,
            timeoutCount: 0,
            lastReset: Date.now()
        };
        this.responseTimes = [];
        
        logInfo('Performance metrics reset');
    }

    private startReporting(): void {
        this.reportingTimer = setInterval(() => {
            this.reportMetrics();
        }, this.REPORTING_INTERVAL);
    }

    private reportMetrics(): void {
        const metrics = this.getMetrics();
        const successRate = this.getSuccessRate();
        const timeoutRate = this.getTimeoutRate();
        
        logInfo('Performance Report', {
            requestCount: metrics.requestCount,
            successRate: `${successRate.toFixed(2)}%`,
            timeoutRate: `${timeoutRate.toFixed(2)}%`,
            avgResponseTime: `${metrics.averageResponseTime.toFixed(0)}ms`,
            p95ResponseTime: `${metrics.p95ResponseTime.toFixed(0)}ms`,
            timespan: `${Math.round((Date.now() - metrics.lastReset) / 1000)}s`
        });

        // Alert on poor performance
        if (successRate < 90 && metrics.requestCount > 10) {
            logWarn('Poor success rate detected', {
                successRate: `${successRate.toFixed(2)}%`,
                recommendations: 'Consider switching providers or reducing request rate'
            });
        }

        if (timeoutRate > 5 && metrics.requestCount > 10) {
            logWarn('High timeout rate detected', {
                timeoutRate: `${timeoutRate.toFixed(2)}%`,
                recommendations: 'Consider reducing timeout values or checking network connectivity'
            });
        }

        if (metrics.p95ResponseTime > 8000) {
            logWarn('High response times detected', {
                p95ResponseTime: `${metrics.p95ResponseTime.toFixed(0)}ms`,
                recommendations: 'Consider optimizing requests or using faster providers'
            });
        }
    }

    stop(): void {
        if (this.reportingTimer) {
            clearInterval(this.reportingTimer);
            this.reportingTimer = null;
        }
    }
}