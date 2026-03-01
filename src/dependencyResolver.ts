import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile } from 'child_process';

interface Dependency {
    groupId: string;
    artifactId: string;
    version: string;
}

type BuildTool = 'maven' | 'gradle' | 'none';

export class DependencyResolver {
    private workspaceRoot: string;
    private outputChannel: vscode.OutputChannel;
    private buildTool: BuildTool | null = null;
    private dependencies: Dependency[] = [];
    private extractedCache = new Map<string, string>();
    private tempDir: string;
    private initPromise: Promise<void> | null = null;
    private offeredSourceDownload = false;

    constructor(workspaceRoot: string, outputChannel: vscode.OutputChannel) {
        this.workspaceRoot = workspaceRoot;
        this.outputChannel = outputChannel;
        this.tempDir = path.join(os.tmpdir(), 'heaplens-sources');
    }

    async resolveFromDependencies(className: string): Promise<vscode.Uri | null> {
        await this.ensureInitialized();

        if (this.buildTool === 'none' || this.dependencies.length === 0) {
            return null;
        }

        // Strip array suffix and inner class
        let baseName = className.replace(/\[\]+$/, '');
        if (baseName.includes('$')) {
            baseName = baseName.substring(0, baseName.indexOf('$'));
        }

        // Convert to internal path: com.example.Foo → com/example/Foo.java
        const internalPath = baseName.replace(/\./g, '/') + '.java';

        // Check cache
        const cached = this.extractedCache.get(internalPath);
        if (cached && fs.existsSync(cached)) {
            return vscode.Uri.file(cached);
        }

        // Try each dependency's source JAR
        for (const dep of this.dependencies) {
            const jarPath = this.findSourceJar(dep);
            if (!jarPath) {
                continue;
            }

            const extracted = await this.extractFromJar(jarPath, internalPath);
            if (extracted) {
                this.extractedCache.set(internalPath, extracted);
                return vscode.Uri.file(extracted);
            }
        }

        // Maven: offer to download source JARs if not yet offered
        if (this.buildTool === 'maven' && !this.offeredSourceDownload) {
            const downloaded = await this.offerSourceDownload();
            if (downloaded) {
                // Retry after download
                for (const dep of this.dependencies) {
                    const jarPath = this.findSourceJar(dep);
                    if (!jarPath) {
                        continue;
                    }
                    const extracted = await this.extractFromJar(jarPath, internalPath);
                    if (extracted) {
                        this.extractedCache.set(internalPath, extracted);
                        return vscode.Uri.file(extracted);
                    }
                }
            }
        }

        return null;
    }

    private async ensureInitialized(): Promise<void> {
        if (this.buildTool !== null) {
            return;
        }

        // Concurrency guard: if init is in progress, wait for it
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = this.initialize();
        try {
            await this.initPromise;
        } finally {
            this.initPromise = null;
        }
    }

    private async initialize(): Promise<void> {
        const config = vscode.workspace.getConfiguration('heaplens');
        if (config.get<boolean>('sourceResolution.enabled') === false) {
            this.buildTool = 'none';
            this.outputChannel.appendLine('HeapLens: Source resolution disabled via setting');
            return;
        }

        this.buildTool = this.detectBuildTool();
        this.outputChannel.appendLine(`HeapLens: Detected build tool: ${this.buildTool}`);

        if (this.buildTool === 'none') {
            return;
        }

        try {
            if (this.buildTool === 'maven') {
                this.dependencies = await this.loadMavenDependencies();
            } else {
                this.dependencies = await this.loadGradleDependencies();
            }
            this.outputChannel.appendLine(`HeapLens: Loaded ${this.dependencies.length} dependencies`);
        } catch (err: any) {
            this.outputChannel.appendLine(`HeapLens: Failed to load dependencies: ${err.message}`);
            this.dependencies = [];
        }
    }

    private detectBuildTool(): BuildTool {
        if (fs.existsSync(path.join(this.workspaceRoot, 'pom.xml'))) {
            return 'maven';
        }
        if (fs.existsSync(path.join(this.workspaceRoot, 'build.gradle')) ||
            fs.existsSync(path.join(this.workspaceRoot, 'build.gradle.kts'))) {
            return 'gradle';
        }
        return 'none';
    }

    private loadMavenDependencies(): Promise<Dependency[]> {
        const tmpFile = path.join(os.tmpdir(), `heaplens-mvn-deps-${Date.now()}.txt`);

        return new Promise((resolve) => {
            execFile('mvn', ['dependency:list', `-DoutputFile=${tmpFile}`, '-DincludeScope=compile'],
                { cwd: this.workspaceRoot, timeout: 60000 },
                (error, _stdout, stderr) => {
                    if (error) {
                        if ((error as any).code === 'ENOENT') {
                            this.outputChannel.appendLine('HeapLens: mvn not found on PATH');
                        } else {
                            this.outputChannel.appendLine(`HeapLens: mvn dependency:list failed: ${stderr}`);
                        }
                        resolve([]);
                        return;
                    }

                    try {
                        const content = fs.readFileSync(tmpFile, 'utf-8');
                        const deps = this.parseMavenOutput(content);
                        fs.unlinkSync(tmpFile);
                        resolve(deps);
                    } catch (e: any) {
                        this.outputChannel.appendLine(`HeapLens: Failed to parse Maven output: ${e.message}`);
                        resolve([]);
                    }
                }
            );
        });
    }

    private parseMavenOutput(content: string): Dependency[] {
        const deps: Dependency[] = [];
        // Lines like: "   com.google.guava:guava:jar:31.1-jre:compile"
        const pattern = /^\s+([\w.-]+):([\w.-]+):\w+:([\w.-]+)/;

        for (const line of content.split('\n')) {
            const match = line.match(pattern);
            if (match) {
                deps.push({
                    groupId: match[1],
                    artifactId: match[2],
                    version: match[3]
                });
            }
        }
        return deps;
    }

    private loadGradleDependencies(): Promise<Dependency[]> {
        // Prefer wrapper
        const useWrapper = fs.existsSync(path.join(this.workspaceRoot, 'gradlew'));
        const cmd = useWrapper ? path.join(this.workspaceRoot, 'gradlew') : 'gradle';

        return new Promise((resolve) => {
            execFile(cmd,
                ['dependencies', '--configuration', 'compileClasspath', '--console=plain'],
                { cwd: this.workspaceRoot, timeout: 120000 },
                (error, stdout, stderr) => {
                    if (error) {
                        if ((error as any).code === 'ENOENT') {
                            this.outputChannel.appendLine('HeapLens: gradle not found on PATH');
                        } else {
                            this.outputChannel.appendLine(`HeapLens: gradle dependencies failed: ${stderr}`);
                        }
                        resolve([]);
                        return;
                    }

                    try {
                        resolve(this.parseGradleOutput(stdout));
                    } catch (e: any) {
                        this.outputChannel.appendLine(`HeapLens: Failed to parse Gradle output: ${e.message}`);
                        resolve([]);
                    }
                }
            );
        });
    }

    private parseGradleOutput(output: string): Dependency[] {
        const seen = new Set<string>();
        const deps: Dependency[] = [];
        // Lines like: "+--- com.google.guava:guava:31.1-jre" or "-> 31.1-jre"
        const pattern = /[+\\|]---\s+([\w.-]+):([\w.-]+):([\w.-]+)(?:\s+->\s+([\w.-]+))?/;

        for (const line of output.split('\n')) {
            const match = line.match(pattern);
            if (match) {
                const version = match[4] || match[3]; // Use resolved version if present
                const key = `${match[1]}:${match[2]}:${version}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    deps.push({
                        groupId: match[1],
                        artifactId: match[2],
                        version: version
                    });
                }
            }
        }
        return deps;
    }

    private findSourceJar(dep: Dependency): string | null {
        if (this.buildTool === 'maven') {
            return this.findMavenSourceJar(dep);
        }
        return this.findGradleSourceJar(dep);
    }

    private findMavenSourceJar(dep: Dependency): string | null {
        const config = vscode.workspace.getConfiguration('heaplens');
        const customHome = config.get<string>('sourceResolution.mavenHome');
        const repoRoot = customHome || path.join(os.homedir(), '.m2', 'repository');

        const groupPath = dep.groupId.replace(/\./g, '/');
        const jarPath = path.join(repoRoot, groupPath, dep.artifactId, dep.version,
            `${dep.artifactId}-${dep.version}-sources.jar`);

        return fs.existsSync(jarPath) ? jarPath : null;
    }

    private findGradleSourceJar(dep: Dependency): string | null {
        const config = vscode.workspace.getConfiguration('heaplens');
        const customHome = config.get<string>('sourceResolution.gradleHome');
        const cacheRoot = customHome || path.join(os.homedir(), '.gradle', 'caches',
            'modules-2', 'files-2.1');

        const depDir = path.join(cacheRoot, dep.groupId, dep.artifactId, dep.version);
        if (!fs.existsSync(depDir)) {
            return null;
        }

        // Scan hash directories for sources JAR
        const sourcesName = `${dep.artifactId}-${dep.version}-sources.jar`;
        try {
            for (const hashDir of fs.readdirSync(depDir)) {
                const candidate = path.join(depDir, hashDir, sourcesName);
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
            }
        } catch {
            // Directory read failed
        }
        return null;
    }

    private extractFromJar(jarPath: string, internalPath: string): Promise<string | null> {
        return new Promise((resolve) => {
            const outPath = path.join(this.tempDir, internalPath);
            const outDir = path.dirname(outPath);

            execFile('unzip', ['-p', jarPath, internalPath], { timeout: 10000 },
                (error, stdout, _stderr) => {
                    if (error || !stdout) {
                        // File not in this JAR, or unzip failed
                        return resolve(null);
                    }

                    try {
                        fs.mkdirSync(outDir, { recursive: true });
                        fs.writeFileSync(outPath, stdout, 'utf-8');
                        resolve(outPath);
                    } catch (e: any) {
                        this.outputChannel.appendLine(`HeapLens: Failed to write extracted source: ${e.message}`);
                        resolve(null);
                    }
                }
            );
        });
    }

    private async offerSourceDownload(): Promise<boolean> {
        this.offeredSourceDownload = true;

        const choice = await vscode.window.showInformationMessage(
            'HeapLens: Source JARs not found for some dependencies. Download via Maven?',
            'Download Sources', 'No'
        );

        if (choice !== 'Download Sources') {
            return false;
        }

        return vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'HeapLens: Downloading source JARs...' },
            () => new Promise<boolean>((resolve) => {
                execFile('mvn', ['dependency:sources'],
                    { cwd: this.workspaceRoot, timeout: 300000 },
                    (error, _stdout, stderr) => {
                        if (error) {
                            this.outputChannel.appendLine(`HeapLens: mvn dependency:sources failed: ${stderr}`);
                            vscode.window.showWarningMessage('HeapLens: Failed to download some source JARs.');
                            resolve(false);
                        } else {
                            vscode.window.showInformationMessage('HeapLens: Source JARs downloaded successfully.');
                            resolve(true);
                        }
                    }
                );
            })
        );
    }

    async dispose(): Promise<void> {
        try {
            if (fs.existsSync(this.tempDir)) {
                fs.rmSync(this.tempDir, { recursive: true, force: true });
            }
        } catch (e: any) {
            this.outputChannel.appendLine(`HeapLens: Failed to clean temp dir: ${e.message}`);
        }
        this.extractedCache.clear();
        this.dependencies = [];
        this.buildTool = null;
    }
}
