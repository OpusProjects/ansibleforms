'use strict';
import CrudModel from './crud.model.js';
import mysql from './db.model.js';

class Group extends CrudModel {
    static modelName = 'groups';

    static async create(data) {
        return super.create(this.modelName, data);
    }
    static async update(data, id) {
        // The admins group keeps its name - check by name, not ID. Its description may change.
        const group = await super.findById(this.modelName, id);
        if (group && group.name === 'admins' && data.name !== undefined && data.name !== 'admins') {
            throw new Error("You cannot rename group 'admins'");
        }
        return super.update(this.modelName, data, id);
    }
    static async delete(id) {
        // Prevent deletion of admins group - check by name, not ID
        const group = await super.findById(this.modelName, id);
        if (group && group.name === 'admins') {
            throw new Error("You cannot delete group 'admins'");
        }
        // Prevent deletion of groups that still have users (FK is CASCADE, so we must check manually)
        const [row] = await mysql.do("SELECT COUNT(*) as cnt FROM AnsibleForms.`users` WHERE group_id = ?", [id]);
        if (row && row.cnt > 0) {
            throw new Error("Group still has users");
        }
        return super.delete(this.modelName, id);
    }
    static async findById(id) {
        return super.findById(this.modelName, id);
    }
    static async findAll() {
        return super.findAll(this.modelName);
    }
    static async findByName(name) {
        return super.findByName(this.modelName, name);
    }
}

export default Group;
