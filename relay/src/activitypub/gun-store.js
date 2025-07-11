/**
 * GunDB Store Adapter for activitypub-express
 *
 * This adapter provides a bridge between activitypub-express and GunDB,
 * allowing ActivityPub data (actors, activities, etc.) to be stored
 * and retrieved from a decentralized Gun graph.
 *
 * @class GunStore
 */
class GunStore {
  constructor(gun) {
    if (!gun) {
      throw new Error('A Gun instance must be provided.');
    }
    this.gun = gun;
  }

  /**
   * Helper to convert an ActivityPub ID (URL) to a Gun node path.
   * @param {URL | string} id - The ID of the object.
   * @returns {string} The path for the Gun node.
   * @private
   */
  _getPath(id) {
    try {
      const url = new URL(id.toString());
      // Use pathname, remove leading slash to avoid empty root node
      return url.pathname.substring(1);
    } catch (e) {
      // If it's not a full URL, treat it as a path already
      return id.toString();
    }
  }

  /**
   * Generates a new unique ID.
   * In Gun, paths act as unique identifiers.
   * For simplicity, we can use a timestamp-based random string.
   *
   * @returns {string} A new unique ID.
   */
  generateId() {
    return `shogun-ap-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Creates a new object in the store.
   *
   * @param {object} object - The object to create.
   * @returns {Promise<object>} The created object.
   */
  async create(object) {
    if (!object || !object.id) {
      throw new Error('[GunStore] Object must have an id to be created.');
    }
    const path = this._getPath(object.id);
    const cleanObject = JSON.parse(JSON.stringify(object));

    this.gun.get(path).put(cleanObject);
    console.log(`[GunStore] Created object at path: ${path}`);
    return object;
  }

  /**
   * Updates an existing object in the store.
   *
   * @param {URL | string} id - The ID of the object to update.
   * @param {object} object - The object to update.
   * @returns {Promise<object>} The updated object.
   */
  async update(id, object) {
    const path = this._getPath(id);
    const cleanObject = JSON.parse(JSON.stringify(object));
    
    this.gun.get(path).put(cleanObject);
    console.log(`[GunStore] Updated object at path: ${path}`);
    return object;
  }

  /**
   * Retrieves an object from the store by its ID.
   *
   * @param {URL | string} id - The ID of the object to retrieve.
   * @param {boolean} [includeMeta=false] - Whether to include metadata.
   * @returns {Promise<object|null>} The retrieved object or null if not found.
   */
  async getObject(id, includeMeta = false) {
    const path = this._getPath(id);
    console.log(`[GunStore] Getting object from path: ${path}`);

    return new Promise((resolve) => {
      // Use .once() to get the data and not subscribe to updates
      this.gun.get(path).once(data => {
        if (data) {
          // Remove Gun's metadata (`_`) before returning
          const cleanData = JSON.parse(JSON.stringify(data));
          resolve(cleanData);
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Appends an item to a collection.
   *
   * @param {URL | string} collectionId - The ID of the collection.
   * @param {URL | string} item - The item to append.
   * @returns {Promise<void>}
   */
  async append(collectionId, item) {
    const collectionPath = this._getPath(collectionId);
    const itemPath = this._getPath(item);
    
    // We need to fetch the item's data to store it in the set,
    // as Gun's set works with objects, not just references.
    const itemData = await this.getObject(item);

    if (itemData) {
      // In Gun, you add to a set by getting the collection and then
      // using .set() on the item you want to add.
      this.gun.get(collectionPath).set(itemData);
      console.log(`[GunStore] Appended item ${itemPath} to collection ${collectionPath}`);
    } else {
      console.warn(`[GunStore] Could not append item ${itemPath}: item not found.`);
    }
  }

  /**
   * Removes an item from a collection.
   *
   * @param {URL | string} collectionId - The ID of the collection.
   * @param {URL | string} item - The item to remove.
   * @returns {Promise<void>}
   */
  async remove(collectionId, item) {
    const collectionPath = this._getPath(collectionId);
    const itemPath = this._getPath(item);
    
    // To "remove" from a set in Gun, you set its node link to null.
    // This requires knowing the specific soul of the item within the set,
    // which can be tricky. A simpler, though less efficient way, is to
    // iterate and rebuild the set without the item.
    // For now, we'll use a placeholder `null` approach, which marks the relation as deleted.
    this.gun.get(collectionPath).get(itemPath).put(null);
    
    console.log(`[GunStore] Removed item ${itemPath} from collection ${collectionPath}`);
  }

  /**
   * Finds an object by a specific property and value.
   *
   * @param {object} match - The property-value pair to match.
   * @param {boolean} [includeMeta=false] - Whether to include metadata.
   * @returns {Promise<object|null>} The found object or null.
   */
  async findObject(match, includeMeta = false) {
    console.log('[GunStore] Stub: findObject called with:', match, includeMeta);
    // This is a simplified implementation for finding actors by preferredUsername,
    // which is a common use case for `findObject` in activitypub-express.
    // A full implementation would require iterating over all known objects,
    // which can be inefficient in GunDB.

    if (match && match.preferredUsername) {
      // Actors are expected to be at a path like 'ap/u/username'
      const username = match.preferredUsername;
      const actorPath = `ap/u/${username}`;
      
      const foundActor = await this.getObject(actorPath);
      
      if (foundActor && foundActor.preferredUsername === username) {
        return foundActor;
      }
    }

    // Return null if no match is found or the match type is not supported yet
    return null;
  }
}

export default GunStore; 