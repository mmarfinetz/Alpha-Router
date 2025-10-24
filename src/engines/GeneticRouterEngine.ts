/**
 * Simplified Genetic Algorithm Router Engine for Academic Publication
 *
 * This is a basic implementation of NSGA-II for multi-objective DEX routing.
 * For educational and research purposes only.
 *
 * Paper: "Hybrid Genetic Algorithm for Optimal User Order Routing in CoW Protocol"
 */

export interface RouteHop {
  fromToken: string;
  toToken: string;
  poolAddress: string;
  protocol: string;
}

export interface Chromosome {
  id: string;
  paths: RouteHop[][];
  splitRatios: number[];
  fitness: FitnessVector;
  rank?: number;
  crowdingDistance?: number;
}

export interface FitnessVector {
  surplus: number;      // To maximize
  gasUnits: number;     // To minimize
  slippage: number;     // To minimize
}

export interface GAConfig {
  populationSize: number;
  maxGenerations: number;
  crossoverRate: number;
  mutationRate: number;
  eliteCount: number;
  maxPaths: number;
  maxPathLength: number;
  timeBudgetMs: number;
}

export class GeneticRouterEngine {
  private config: GAConfig;
  private population: Chromosome[] = [];
  private generation = 0;
  private startTime = 0;

  constructor(config: GAConfig) {
    this.config = config;
  }

  /**
   * Main optimization loop
   */
  public optimize(
    startToken: string,
    endToken: string,
    amount: number,
    markets: any[]
  ): { best: Chromosome; paretoFront: Chromosome[]; generations: number } {
    this.startTime = Date.now();
    this.generation = 0;

    // Initialize population
    this.initializePopulation(startToken, endToken, markets);

    // Evolution loop
    while (
      this.generation < this.config.maxGenerations &&
      Date.now() - this.startTime < this.config.timeBudgetMs
    ) {
      // Evaluate fitness
      this.evaluateFitness(amount, markets);

      // Non-dominated sorting
      this.nondominatedSort();

      // Calculate crowding distance
      this.calculateCrowdingDistance();

      // Selection and reproduction
      const offspring = this.reproduce();

      // Environmental selection
      this.population = this.environmentalSelection([...this.population, ...offspring]);

      this.generation++;
    }

    // Final evaluation
    this.evaluateFitness(amount, markets);
    this.nondominatedSort();

    const paretoFront = this.population.filter(c => c.rank === 1);
    const best = this.selectBest(paretoFront);

    return {
      best,
      paretoFront,
      generations: this.generation
    };
  }

  /**
   * Initialize population with random chromosomes
   */
  private initializePopulation(startToken: string, endToken: string, markets: any[]): void {
    this.population = [];

    for (let i = 0; i < this.config.populationSize; i++) {
      const numPaths = 1 + Math.floor(Math.random() * this.config.maxPaths);
      const paths: RouteHop[][] = [];

      for (let j = 0; j < numPaths; j++) {
        const path = this.generateRandomPath(startToken, endToken, markets);
        if (path.length > 0) {
          paths.push(path);
        }
      }

      // Generate split ratios
      const splits = this.generateSplitRatios(paths.length);

      this.population.push({
        id: `chr_${i}`,
        paths,
        splitRatios: splits,
        fitness: { surplus: 0, gasUnits: 0, slippage: 0 }
      });
    }
  }

  /**
   * Generate random path from start to end token
   */
  private generateRandomPath(
    startToken: string,
    endToken: string,
    markets: any[]
  ): RouteHop[] {
    const path: RouteHop[] = [];
    let currentToken = startToken;
    const visited = new Set<string>();

    while (
      currentToken !== endToken &&
      path.length < this.config.maxPathLength &&
      !visited.has(currentToken)
    ) {
      visited.add(currentToken);

      // Find available markets from current token
      const availableMarkets = markets.filter(m =>
        m.tokens.includes(currentToken)
      );

      if (availableMarkets.length === 0) break;

      // Random selection
      const market = availableMarkets[Math.floor(Math.random() * availableMarkets.length)];
      const nextToken = market.tokens.find((t: string) => t !== currentToken);

      if (nextToken) {
        path.push({
          fromToken: currentToken,
          toToken: nextToken,
          poolAddress: market.marketAddress,
          protocol: market.protocol
        });
        currentToken = nextToken;
      }
    }

    return currentToken === endToken ? path : [];
  }

  /**
   * Generate normalized split ratios
   */
  private generateSplitRatios(numPaths: number): number[] {
    const ratios = Array(numPaths).fill(0).map(() => Math.random());
    const sum = ratios.reduce((a, b) => a + b, 0);
    return ratios.map(r => r / sum);
  }

  /**
   * Evaluate fitness for all chromosomes
   */
  private evaluateFitness(amount: number, markets: any[]): void {
    for (const chr of this.population) {
      // Simplified fitness calculation
      let totalSurplus = 0;
      let totalGas = 21000; // Base transaction cost
      let totalSlippage = 0;

      for (let i = 0; i < chr.paths.length; i++) {
        const pathAmount = amount * chr.splitRatios[i];
        const path = chr.paths[i];

        // Estimate output for this path
        let currentAmount = pathAmount;
        for (const hop of path) {
          // Simplified AMM calculation
          const market = markets.find(m => m.marketAddress === hop.poolAddress);
          if (market) {
            // Basic constant product formula
            const fee = 0.003; // 0.3% fee
            currentAmount = currentAmount * (1 - fee) * 0.98; // Simplified slippage
            totalGas += 150000; // Gas per swap
            totalSlippage += pathAmount * 0.02; // 2% slippage estimate
          }
        }

        totalSurplus += currentAmount - pathAmount;
      }

      chr.fitness = {
        surplus: totalSurplus,
        gasUnits: totalGas,
        slippage: totalSlippage
      };
    }
  }

  /**
   * Non-dominated sorting (NSGA-II)
   */
  private nondominatedSort(): void {
    const n = this.population.length;
    const dominationCount = new Array(n).fill(0);
    const dominatedSolutions: number[][] = Array(n).fill(null).map(() => []);
    const fronts: number[][] = [[]];

    // Calculate domination relationships
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dom = this.dominates(this.population[i], this.population[j]);
        if (dom === 1) {
          dominatedSolutions[i].push(j);
          dominationCount[j]++;
        } else if (dom === -1) {
          dominatedSolutions[j].push(i);
          dominationCount[i]++;
        }
      }
    }

    // Find first front
    for (let i = 0; i < n; i++) {
      if (dominationCount[i] === 0) {
        this.population[i].rank = 1;
        fronts[0].push(i);
      }
    }

    // Find remaining fronts
    let currentFront = 0;
    while (fronts[currentFront].length > 0) {
      const nextFront: number[] = [];

      for (const i of fronts[currentFront]) {
        for (const j of dominatedSolutions[i]) {
          dominationCount[j]--;
          if (dominationCount[j] === 0) {
            this.population[j].rank = currentFront + 2;
            nextFront.push(j);
          }
        }
      }

      currentFront++;
      fronts.push(nextFront);
    }
  }

  /**
   * Check if chromosome a dominates chromosome b
   * Returns: 1 if a dominates b, -1 if b dominates a, 0 if neither
   */
  private dominates(a: Chromosome, b: Chromosome): number {
    let aBetter = false;
    let bBetter = false;

    // Maximize surplus
    if (a.fitness.surplus > b.fitness.surplus) aBetter = true;
    else if (b.fitness.surplus > a.fitness.surplus) bBetter = true;

    // Minimize gas
    if (a.fitness.gasUnits < b.fitness.gasUnits) aBetter = true;
    else if (b.fitness.gasUnits < a.fitness.gasUnits) bBetter = true;

    // Minimize slippage
    if (a.fitness.slippage < b.fitness.slippage) aBetter = true;
    else if (b.fitness.slippage < a.fitness.slippage) bBetter = true;

    if (aBetter && !bBetter) return 1;
    if (bBetter && !aBetter) return -1;
    return 0;
  }

  /**
   * Calculate crowding distance for diversity preservation
   */
  private calculateCrowdingDistance(): void {
    const fronts: Map<number, Chromosome[]> = new Map();

    // Group by rank
    for (const chr of this.population) {
      const rank = chr.rank || 1;
      if (!fronts.has(rank)) {
        fronts.set(rank, []);
      }
      fronts.get(rank)!.push(chr);
    }

    // Calculate distance for each front
    for (const front of fronts.values()) {
      if (front.length <= 2) {
        front.forEach(chr => chr.crowdingDistance = Infinity);
        continue;
      }

      // Initialize distances
      front.forEach(chr => chr.crowdingDistance = 0);

      // For each objective
      const objectives = ['surplus', 'gasUnits', 'slippage'] as const;

      for (const obj of objectives) {
        // Sort by objective
        front.sort((a, b) => a.fitness[obj] - b.fitness[obj]);

        // Boundary points
        front[0].crowdingDistance = Infinity;
        front[front.length - 1].crowdingDistance = Infinity;

        // Calculate distance
        const range = front[front.length - 1].fitness[obj] - front[0].fitness[obj];
        if (range > 0) {
          for (let i = 1; i < front.length - 1; i++) {
            const distance = (front[i + 1].fitness[obj] - front[i - 1].fitness[obj]) / range;
            front[i].crowdingDistance! += distance;
          }
        }
      }
    }
  }

  /**
   * Tournament selection
   */
  private tournamentSelection(): Chromosome {
    const tournamentSize = 3;
    let best: Chromosome | null = null;

    for (let i = 0; i < tournamentSize; i++) {
      const candidate = this.population[Math.floor(Math.random() * this.population.length)];

      if (!best ||
          candidate.rank! < best.rank! ||
          (candidate.rank === best.rank && candidate.crowdingDistance! > best.crowdingDistance!)) {
        best = candidate;
      }
    }

    return best!;
  }

  /**
   * Crossover operator
   */
  private crossover(parent1: Chromosome, parent2: Chromosome): Chromosome[] {
    if (Math.random() > this.config.crossoverRate) {
      return [this.cloneChromosome(parent1), this.cloneChromosome(parent2)];
    }

    // Simple path exchange crossover
    const child1paths = [...parent1.paths];
    const child2paths = [...parent2.paths];

    if (child1paths.length > 1 && child2paths.length > 1) {
      const point = Math.floor(Math.random() * Math.min(child1paths.length, child2paths.length));

      // Exchange paths
      const temp = child1paths.slice(point);
      child1paths.splice(point, child1paths.length - point, ...child2paths.slice(point));
      child2paths.splice(point, child2paths.length - point, ...temp);
    }

    return [
      {
        id: `chr_${Date.now()}_1`,
        paths: child1paths,
        splitRatios: this.generateSplitRatios(child1paths.length),
        fitness: { surplus: 0, gasUnits: 0, slippage: 0 }
      },
      {
        id: `chr_${Date.now()}_2`,
        paths: child2paths,
        splitRatios: this.generateSplitRatios(child2paths.length),
        fitness: { surplus: 0, gasUnits: 0, slippage: 0 }
      }
    ];
  }

  /**
   * Mutation operator
   */
  private mutate(chromosome: Chromosome): void {
    if (Math.random() < this.config.mutationRate) {
      // Mutate split ratios
      if (Math.random() < 0.5) {
        chromosome.splitRatios = this.generateSplitRatios(chromosome.splitRatios.length);
      }

      // Mutate path (simplified - just regenerate one path)
      if (chromosome.paths.length > 0 && Math.random() < 0.5) {
        const idx = Math.floor(Math.random() * chromosome.paths.length);
        // In real implementation, would modify the path
        // For simplicity, just slightly adjust split ratios
        const adjustment = (Math.random() - 0.5) * 0.1;
        chromosome.splitRatios[idx] = Math.max(0.01, Math.min(0.99,
          chromosome.splitRatios[idx] + adjustment));

        // Renormalize
        const sum = chromosome.splitRatios.reduce((a, b) => a + b, 0);
        chromosome.splitRatios = chromosome.splitRatios.map(r => r / sum);
      }
    }
  }

  /**
   * Generate offspring population
   */
  private reproduce(): Chromosome[] {
    const offspring: Chromosome[] = [];

    while (offspring.length < this.config.populationSize) {
      const parent1 = this.tournamentSelection();
      const parent2 = this.tournamentSelection();

      const children = this.crossover(parent1, parent2);

      children.forEach(child => {
        this.mutate(child);
        offspring.push(child);
      });
    }

    return offspring.slice(0, this.config.populationSize);
  }

  /**
   * Environmental selection (survival of the fittest)
   */
  private environmentalSelection(combined: Chromosome[]): Chromosome[] {
    // Sort by rank, then by crowding distance
    combined.sort((a, b) => {
      if (a.rank !== b.rank) {
        return (a.rank || 0) - (b.rank || 0);
      }
      return (b.crowdingDistance || 0) - (a.crowdingDistance || 0);
    });

    return combined.slice(0, this.config.populationSize);
  }

  /**
   * Select best solution from Pareto front
   */
  private selectBest(paretoFront: Chromosome[]): Chromosome {
    // Simple selection: highest surplus
    return paretoFront.reduce((best, current) =>
      current.fitness.surplus > best.fitness.surplus ? current : best
    );
  }

  /**
   * Clone chromosome
   */
  private cloneChromosome(chr: Chromosome): Chromosome {
    return {
      id: `chr_clone_${Date.now()}`,
      paths: chr.paths.map(p => [...p]),
      splitRatios: [...chr.splitRatios],
      fitness: { ...chr.fitness },
      rank: chr.rank,
      crowdingDistance: chr.crowdingDistance
    };
  }
}