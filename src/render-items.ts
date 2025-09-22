import { mkdir, writeFile, access, readdir, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import createGL from 'gl'
import { createCanvas, loadImage, ImageData as CanvasImageData, type Image } from '@napi-rs/canvas'
import { Identifier, ItemModel, ItemStack, NbtByte, NbtCompound, NbtDouble, NbtInt, NbtList, NbtString, type NbtTag } from 'deepslate'
import type { ItemComponentsProvider, ItemModelProvider } from 'deepslate'
import {
	BlockDefinition,
	BlockModel,
	ItemRenderer,
	TextureAtlas,
	upperPowerOfTwo,
	type BlockDefinitionProvider,
	type BlockFlagsProvider,
	type BlockModelProvider,
	type BlockPropertiesProvider,
	type TextureAtlasProvider,
	type UV,
} from 'deepslate/render'
import { getHardcodedTwoDItemIds } from './twoD-overrides.js'

const VERSION_REF = process.env.VOXEL_MC_VERSION ?? 'latest'
const VERSION_ID = VERSION_REF
const RENDER_SIZE = 128
const MC_META_BASE = 'https://raw.githubusercontent.com/misode/mcmeta'
const ASSET_REGISTRIES = new Set([
	'atlas',
	'block_definition',
	'item_definition',
	'model',
	'font',
	'lang',
	'equipment',
	'post_effect',
])

const COLOR = {
	reset: '\x1b[0m',
	yellow: '\x1b[33m',
	green: '\x1b[32m',
}

async function main() {
	const filename = fileURLToPath(import.meta.url)
	const dirname = path.dirname(filename)

	const availableIds = await fetchItemRegistryList()

	const [itemComponentsJson, resourcesData, detectedTwoDItemIds] = await Promise.all([
		fetchItemComponents(),
		fetchResources(),
		fetchTwoDItemIds(),
	])
	const twoDItemIds = new Set<string>([...detectedTwoDItemIds, ...getHardcodedTwoDItemIds()])
	const itemComponentsNbt = convertItemComponents(itemComponentsJson)
	const resources = new ResourceManager(
		VERSION_ID,
		resourcesData.blockDefinitions,
		resourcesData.models,
		resourcesData.uvMapping,
		resourcesData.atlasImage,
		resourcesData.itemDefinitions,
		itemComponentsNbt,
	)

	const outputDir = path.resolve(dirname, '..', 'output')
	await mkdir(outputDir, { recursive: true })

	for (const id of availableIds) {
		const identifier = Identifier.parse(`minecraft:${id}`)
		if (!resources.getItemModel(identifier)) {
			console.log(`${COLOR.yellow}Skipping ${id}: no item model${COLOR.reset}`)
			continue
		}
		try {
			const outPath = path.join(outputDir, `${id}.png`)
			try {
				await access(outPath)
				console.log(`${COLOR.yellow}Skipping ${id}: output exists${COLOR.reset}`)
				continue
			} catch { }
			const item = new ItemStack(identifier, 1)
			const size = twoDItemIds.has(id) ? 16 : RENDER_SIZE
			const png = await renderItemToPng(item, resources, size)
			await writeFile(outPath, png)
			console.log(`${COLOR.green}Rendered ${id}${COLOR.reset} (${size}x${size}) -> ${path.relative(process.cwd(), outPath)}`)
		} catch (e) {
			console.warn(`Failed to render ${id}:`, e)
		}
	}

	await mergeHardcodedIcons(path.resolve(dirname, '..', 'hardcoded'), outputDir)
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})

type ItemComponentJson = Map<string, Map<string, unknown>>

async function fetchResources() {
	const [blockDefinitions, models, uvMapping, atlasImage, itemDefinitions] = await Promise.all([
		fetchAllPresets('block_definition'),
		fetchAllPresets('model'),
		fetchJson<Record<string, [number, number, number, number]>>(atlasUrl('all/data.min.json')),
		loadAtlasImage(atlasUrl('all/atlas.png')),
		fetchAllPresets('item_definition'),
	])
	return { blockDefinitions, models, uvMapping, atlasImage, itemDefinitions }
}

async function fetchItemComponents(): Promise<ItemComponentJson> {
	const url = summaryUrl('item_components/data.min.json')
	const data = await fetchJson<Record<string, Record<string, unknown> | Array<{ type: string, value: unknown }>>>(url)
	const result = new Map<string, Map<string, unknown>>()
	for (const [key, components] of Object.entries(data)) {
		const base = new Map<string, unknown>()
		if (Array.isArray(components)) {
			for (const entry of components) {
				base.set(entry.type, entry.value)
			}
		} else {
			for (const [componentId, value] of Object.entries(components ?? {})) {
				base.set(componentId, value)
			}
		}
		result.set(`minecraft:${key}`, base)
	}
	return result
}

async function fetchAllPresets(registry: string) {
	const type = ASSET_REGISTRIES.has(registry) ? 'assets' : 'data'
	const url = summaryUrl(`${type}/${registry}/data.min.json`)
	const data = await fetchJson<Record<string, unknown>>(url)
	return new Map<string, unknown>(Object.entries(data))
}

function summaryUrl(pathname: string) {
	return VERSION_REF === 'latest'
		? `${MC_META_BASE}/summary/${pathname}`
		: `${MC_META_BASE}/${VERSION_REF}-summary/${pathname}`
}

function atlasUrl(pathname: string) {
	return VERSION_REF === 'latest'
		? `${MC_META_BASE}/atlas/${pathname}`
		: `${MC_META_BASE}/${VERSION_REF}-atlas/${pathname}`
}

async function fetchItemRegistryList(): Promise<string[]> {
	return fetchJson<string[]>(`${MC_META_BASE}/registries/item/data.json`)
}

async function fetchTwoDItemIds(): Promise<Set<string>> {
	const textures = await fetchJson<string[]>(`${MC_META_BASE}/registries/texture/data.json`)
	const twoD = new Set<string>()
	for (const tex of textures) {
		if (tex.startsWith('item/')) {
			const id = tex.slice('item/'.length)
			if (id) twoD.add(id)
		}
	}
	return twoD
}

async function fetchJson<T>(url: string): Promise<T> {
	const res = await fetch(url)
	if (!res.ok) {
		throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`)
	}
	return res.json() as Promise<T>
}

async function loadAtlasImage(url: string): Promise<Image> {
	const res = await fetch(url)
	if (!res.ok) {
		throw new Error(`Failed to download atlas image ${url}: ${res.status} ${res.statusText}`)
	}
	const buffer = Buffer.from(await res.arrayBuffer())
	return loadImage(buffer)
}

function convertItemComponents(source: ItemComponentJson) {
	const out = new Map<string, Map<string, NbtTag>>()
	for (const [id, components] of source.entries()) {
		const mapped = new Map<string, NbtTag>()
		for (const [componentId, value] of components.entries()) {
			mapped.set(componentId, jsonToNbt(value))
		}
		out.set(id, mapped)
	}
	return out
}

class ResourceManager implements BlockDefinitionProvider, BlockModelProvider, TextureAtlasProvider, BlockFlagsProvider, BlockPropertiesProvider, ItemModelProvider, ItemComponentsProvider {
	private readonly blockDefinitions: Record<string, BlockDefinition> = {}
	private readonly blockModels: Record<string, BlockModel> = {}
	private readonly itemModels: Record<string, ItemModel> = {}
	private textureAtlas!: TextureAtlas

	constructor(
		private readonly version: string,
		blockDefinitions: Map<string, unknown>,
		models: Map<string, unknown>,
		uvMapping: Record<string, [number, number, number, number]>,
		atlasImage: Image,
		itemDefinitions: Map<string, unknown>,
		private readonly itemComponents: Map<string, Map<string, NbtTag>>,
	) {
		this.loadBlockDefinitions(blockDefinitions)
		this.loadBlockModels(models)
		this.loadBlockAtlas(atlasImage, uvMapping)
		this.loadItemModels(itemDefinitions)
	}

	public getBlockDefinition(id: Identifier) {
		return this.blockDefinitions[id.toString()]
	}

	public getBlockModel(id: Identifier) {
		return this.blockModels[id.toString()]
	}

	public getTextureUV(id: Identifier) {
		return this.textureAtlas.getTextureUV(id)
	}

	public getTextureAtlas() {
		return this.textureAtlas.getTextureAtlas()
	}

	public getBlockFlags() {
		return { opaque: false }
	}

	public getBlockProperties() {
		return null
	}

	public getDefaultBlockProperties() {
		return null
	}

	public getItemModel(id: Identifier) {
		return this.itemModels[id.toString()]
	}

	public getItemComponents(id: Identifier) {
		return this.itemComponents.get(id.toString()) ?? new Map()
	}

	private loadBlockDefinitions(definitions: Map<string, unknown>) {
		for (const [id, definition] of definitions.entries()) {
			this.blockDefinitions[Identifier.create(id).toString()] = BlockDefinition.fromJson(definition)
		}
	}

	private loadBlockModels(models: Map<string, unknown>) {
		for (const [id, model] of models.entries()) {
			this.blockModels[Identifier.create(id).toString()] = BlockModel.fromJson(model)
		}
		for (const model of Object.values(this.blockModels)) {
			model.flatten(this)
		}
	}

	private loadItemModels(definitions: Map<string, unknown>) {
		for (const [id, definition] of definitions.entries()) {
			if (isRecord(definition) && isRecord(definition.model)) {
				this.itemModels[Identifier.create(id).toString()] = ItemModel.fromJson(definition.model)
			}
		}
	}

	private loadBlockAtlas(image: Image | CanvasImageData, textures: Record<string, [number, number, number, number]>) {
		const w = upperPowerOfTwo(image.width)
		const h = upperPowerOfTwo(image.height)
		const atlasCanvas = createCanvas(w, h)
		const ctx = atlasCanvas.getContext('2d')

		if ('data' in image) {
			const imageData = new CanvasImageData(image.data, image.width, image.height)
			ctx.putImageData(imageData, 0, 0)
		} else {
			ctx.drawImage(image, 0, 0)
		}

		const imageData = ctx.getImageData(0, 0, w, h)
		const idMap: Record<string, UV> = {}
		for (const [rawId, tuple] of Object.entries(textures)) {
			const [u, v, du, dv] = tuple
			const dv2 = (du !== dv && rawId.startsWith('block/')) ? du : dv
			idMap[Identifier.create(rawId).toString()] = [u / w, v / h, (u + du) / w, (v + dv2) / h]
		}
		this.textureAtlas = new TextureAtlas(imageData as unknown as ImageData, idMap)
	}
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null
}

async function renderItemToPng(item: ItemStack, resources: ResourceManager, size: number) {
	const gl = createGL(size, size, { preserveDrawingBuffer: true }) as any;
	gl.canvas = { width: size, height: size, clientWidth: size, clientHeight: size }

	const renderer = new ItemRenderer(gl, item, resources, { display_context: 'gui' })
	renderer.setViewport(0, 0, size, size)
	gl.clearColor(0, 0, 0, 0)
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
	renderer.drawItem()

	const pixels = new Uint8Array(size * size * 4)
	gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
	gl.destroy?.()

	const flipped = flipYAxis(pixels, size, size)
	const canvas = createCanvas(size, size)
	const ctx = canvas.getContext('2d')
	const imageData = ctx.createImageData(size, size)
	imageData.data.set(flipped)
	ctx.putImageData(imageData, 0, 0)
	return canvas.toBuffer('image/png')
}

function flipYAxis(data: Uint8Array, width: number, height: number) {
	const bytesPerRow = width * 4
	const result = new Uint8ClampedArray(data.length)
	for (let row = 0; row < height; row += 1) {
		const srcStart = row * bytesPerRow
		const destStart = (height - row - 1) * bytesPerRow
		result.set(data.subarray(srcStart, srcStart + bytesPerRow), destStart)
	}
	return result
}

function jsonToNbt(value: unknown): NbtTag {
	if (typeof value === 'string') {
		return new NbtString(value)
	}
	if (typeof value === 'number') {
		return Number.isInteger(value) ? new NbtInt(value) : new NbtDouble(value)
	}
	if (typeof value === 'boolean') {
		return new NbtByte(value)
	}
	if (Array.isArray(value)) {
		return new NbtList(value.map(jsonToNbt))
	}
	if (typeof value === 'object' && value !== null) {
		return new NbtCompound(new Map(Object.entries(value).map(([k, v]) => [k, jsonToNbt(v)])))
	}
	return new NbtByte(0)
}

async function mergeHardcodedIcons(sourceDir: string, outputDir: string) {
	try {
		const entries = await readdir(sourceDir, { withFileTypes: true })
		for (const entry of entries) {
			if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
				const src = path.join(sourceDir, entry.name)
				const dest = path.join(outputDir, entry.name)
				await copyFile(src, dest)
				console.log(`${COLOR.green}Hardcoded${COLOR.reset} -> ${path.relative(process.cwd(), dest)}`)
			}
		}
	} catch {
		// no hardcoded directory, skip
	}
}










