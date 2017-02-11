""" Script to render transaction schema into .rst document """

from collections import OrderedDict
import os.path

import yaml

from bigchaindb.common.schema import TX_SCHEMA_PATH, VOTE_SCHEMA_PATH


TPL_PROP = """\
%(title)s
%(underline)s

**type:** %(type)s

%(description)s
"""


TPL_STYLES = """
.. raw:: html

    <style>
    #%(container)s h2 {
         border-top: solid 3px #6ab0de;
         background-color: #e7f2fa;
         padding: 5px;
    }
    #%(container)s h3 {
         background: #f0f0f0;
         border-left: solid 3px #ccc;
         font-weight: bold;
         padding: 6px;
         font-size: 100%%;
         font-family: monospace;
    }
    .document .section p {
        margin-bottom: 16px;
    }
    .notice {
        margin: 0px 16px 16px 16px;
        background-color: white;
        border: 1px solid gold;
        padding: 3px 6px;
    }
    </style>
"""


TPL_TRANSACTION = TPL_STYLES + """\
..  This file was auto generated by %(file)s

==================
Transaction Schema
==================

* `Transaction`_

* Input_

* Output_

* Asset_

* Metadata_


Transaction
-----------

%(transaction)s

Input
-----

%(input)s

Output
------

%(output)s

Asset
-----

%(asset)s

Metadata
--------

%(metadata)s
"""


def generate_transaction_docs():
    schema = load_schema(TX_SCHEMA_PATH)
    defs = schema['definitions']

    doc = TPL_TRANSACTION % {
        'transaction': render_section('Transaction', schema),
        'output': render_section('Output', defs['output']),
        'input': render_section('Input', defs['input']),
        'asset': render_section('Asset', defs['asset']),
        'metadata': render_section('Metadata', defs['metadata']['anyOf'][0]),
        'container': 'transaction-schema',
        'file': os.path.basename(__file__),
    }

    write_schema_doc('transaction', doc)


TPL_VOTE = TPL_STYLES + """\
..  This file was auto generated by %(file)s

===========
Vote Schema
===========

Vote
----

%(vote)s

Vote Details
------------

%(vote_details)s

"""


def generate_vote_docs():
    schema = load_schema(VOTE_SCHEMA_PATH)

    doc = TPL_VOTE % {
        'vote': render_section('Vote', schema),
        'vote_details': render_section('Vote', schema['properties']['vote']),
        'container': 'vote-schema',
        'file': os.path.basename(__file__),
    }

    write_schema_doc('vote', doc)


def ordered_load_yaml(path):
    """ Custom YAML loader to preserve key order """
    class OrderedLoader(yaml.SafeLoader):
        pass

    def construct_mapping(loader, node):
        loader.flatten_mapping(node)
        return OrderedDict(loader.construct_pairs(node))
    OrderedLoader.add_constructor(
        yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
        construct_mapping)
    with open(path) as handle:
        return yaml.load(handle, OrderedLoader)


def load_schema(path):
    global DEFS
    schema = ordered_load_yaml(path)
    DEFS = schema['definitions']
    return schema


def write_schema_doc(name, doc):
    # Check base path exists
    base_path = os.path.join(os.path.dirname(__file__), 'source/schema')
    if not os.path.exists(base_path):
        os.makedirs(base_path)
    # Write doc
    path = os.path.join(base_path, '%s.rst' % name)
    with open(path, 'w') as handle:
        handle.write(doc)


def render_section(section_name, obj):
    """ Render a domain object and it's properties """
    out = [obj['description']]
    for name, prop in obj.get('properties', {}).items():
        try:
            title = '%s.%s' % (section_name, name)
            out += [TPL_PROP % {
                'title': title,
                'underline': '^' * len(title),
                'description': property_description(prop),
                'type': property_type(prop),
            }]
        except Exception as exc:
            raise ValueError('Error rendering property: %s' % name, exc)
    return '\n\n'.join(out + [''])


def property_description(prop):
    """ Get description of property """
    if 'description' in prop:
        return prop['description']
    if '$ref' in prop:
        return property_description(resolve_ref(prop['$ref']))
    if 'anyOf' in prop:
        return property_description(prop['anyOf'][0])
    raise KeyError('description')


def property_type(prop):
    """ Resolve a string representing the type of a property """
    if 'type' in prop:
        if prop['type'] == 'array':
            return 'array (%s)' % property_type(prop['items'])
        return prop['type']
    if 'anyOf' in prop:
        return ' or '.join(property_type(p) for p in prop['anyOf'])
    if '$ref' in prop:
        return property_type(resolve_ref(prop['$ref']))
    raise ValueError('Could not resolve property type')


DEFINITION_BASE_PATH = '#/definitions/'


def resolve_ref(ref):
    """ Resolve definition reference """
    assert ref.startswith(DEFINITION_BASE_PATH)
    return DEFS[ref[len(DEFINITION_BASE_PATH):]]


def main():
    """ Main function """
    generate_transaction_docs()
    generate_vote_docs()


def setup(*_):
    """ Fool sphinx into think it's an extension muahaha """
    main()


if __name__ == '__main__':
    main()
